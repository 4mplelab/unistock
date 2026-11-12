from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event_log import EventLog
from app.models.order import Order
from app.services.notification_service import notify

# イベントベースの通知対象(状態ベースのreorder_threshold/po_overdue/buildable_thresholdとは
# 別系統、notification_check_service.py参照)
_NOTIFIABLE_CATEGORIES = {"auth_error", "stock_operation_failed", "ec_maintenance"}

# 通知対象のカテゴリで、同じ内容(category, shop_id, order_id, item_id, message)が
# この間隔内に続けて起きている間は、新規行を追加せず既存行へ集約する。
# 通知は最初の1回と、その後は前回の通知からこの間隔が空くたびに再通知する
_RENOTIFY_INTERVAL = timedelta(hours=4)

# 「解消されるまで自動リトライのたびに繰り返し記録されうる」カテゴリ。同一(category,
# order_id, item_id)の行が既にあれば新規行を追加せず、その行のoccurrence_count/
# last_occurred_at/messageを更新するだけにする(件数だけが無意味に膨らむのを防ぐ)。
# auth_error/stock_operation_failed等の「1回の実際の発生」を表すカテゴリは対象外
_AGGREGATABLE_CATEGORIES = {"reservation_skipped", "assembly_stock_shortfall"}


class EventLogService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def log(
        self,
        category: str,
        level: str,
        message: str,
        order_id: int | None = None,
        item_id: str | None = None,
        shop_id: int | None = None,
    ) -> None:
        """業務イベントを1件記録し、その場でコミットする。

        呼び出し元の他の変更(引当処理等)とは独立してすぐ確定させる。呼び出し元が例外処理中で
        セッションをrollback済みの場合でも、この呼び出し自体は新しい行の追加/更新だけなので安全。

        category が _AGGREGATABLE_CATEGORIES に含まれる場合、同一(category, order_id,
        item_id)の既存行があれば新規行を追加せず、その行を更新する(occurrence_countを
        増やし、last_occurred_at/messageを最新化する)。

        category が _NOTIFIABLE_CATEGORIES に含まれる場合、通知(Webhook/メール)も
        あわせて送る(デモモードでは実データではないため送らない)。同じ内容が続いている間は
        既存行へ集約し、前回の通知から _RENOTIFY_INTERVAL 経っていれば再通知する。
        """
        if category in _AGGREGATABLE_CATEGORIES and order_id is not None:
            existing_result = await self._session.execute(
                select(EventLog).where(
                    EventLog.category == category,
                    EventLog.order_id == order_id,
                    EventLog.item_id == item_id,
                )
            )
            existing = existing_result.scalars().first()
            if existing is not None:
                existing.level = level
                existing.message = message
                existing.occurrence_count += 1
                existing.last_occurred_at = datetime.now(timezone.utc)
                await self._session.commit()
                return

        now = datetime.now(timezone.utc)
        should_notify = (
            not settings.demo_mode and level in ("warning", "error") and category in _NOTIFIABLE_CATEGORIES
        )

        if category in _NOTIFIABLE_CATEGORIES:
            recent_result = await self._session.execute(
                select(EventLog)
                .where(
                    EventLog.category == category,
                    EventLog.shop_id.is_(None) if shop_id is None else EventLog.shop_id == shop_id,
                    EventLog.order_id.is_(None) if order_id is None else EventLog.order_id == order_id,
                    EventLog.item_id.is_(None) if item_id is None else EventLog.item_id == item_id,
                    EventLog.message == message,
                    EventLog.last_occurred_at >= now - _RENOTIFY_INTERVAL,
                )
                .order_by(EventLog.last_occurred_at.desc())
            )
            recent = recent_result.scalars().first()
            if recent is not None:
                recent.level = level
                recent.occurrence_count += 1
                recent.last_occurred_at = now
                renotify = should_notify and (
                    recent.last_notified_at is None or now - recent.last_notified_at >= _RENOTIFY_INTERVAL
                )
                if renotify:
                    recent.last_notified_at = now
                await self._session.commit()
                if renotify:
                    await notify(
                        self._session,
                        category,
                        f"{message}\n(まだ解消していません。これまでに{recent.occurrence_count}回発生しています)",
                        shop_ids=[shop_id],
                    )
                return

        self._session.add(
            EventLog(
                category=category,
                level=level,
                message=message,
                order_id=order_id,
                item_id=item_id,
                shop_id=shop_id,
                last_notified_at=now if should_notify else None,
            )
        )
        await self._session.commit()

        if should_notify:
            await notify(self._session, category, message, shop_ids=[shop_id])

    async def list_recent(
        self,
        limit: int = 20,
        offset: int = 0,
        highlight: int | None = None,
        shop_id: int | None = None,
        include_shared: bool = True,
    ) -> tuple[list[tuple[EventLog, str | None]], int, int]:
        """イベントログ一覧をページ単位で返す。highlight(イベントログid)が指定された場合、
        そのクライアント指定のoffsetは無視し、そのイベントログが含まれるページを
        自動的に計算して返す(ダッシュボードの「直近のイベントログ」から遷移してきた
        場合に、クライアント側で全件検索する必要をなくす)。

        shop_idを渡すとそのショップの行に絞り込む。include_shared(既定True)がTrueの
        間は、shop_id無し(真に共通)の行も一緒に含める。
        """

        def _apply_shop_filter(stmt):
            if shop_id is None:
                return stmt
            if include_shared:
                return stmt.where(or_(EventLog.shop_id == shop_id, EventLog.shop_id.is_(None)))
            return stmt.where(EventLog.shop_id == shop_id)

        total_stmt = _apply_shop_filter(select(func.count()).select_from(EventLog))
        total = (await self._session.execute(total_stmt)).scalar_one()

        page = 1
        if highlight is not None:
            target = await self._session.get(EventLog, highlight)
            if target is not None:
                preceding_stmt = _apply_shop_filter(
                    select(func.count())
                    .select_from(EventLog)
                    .where(EventLog.last_occurred_at > target.last_occurred_at)
                )
                preceding = (await self._session.execute(preceding_stmt)).scalar_one()
                offset = (preceding // limit) * limit if limit > 0 else 0
                page = offset // limit + 1 if limit > 0 else 1

        list_stmt = _apply_shop_filter(
            select(EventLog, Order.unique_key)
            .outerjoin(Order, Order.id == EventLog.order_id)
            .order_by(EventLog.last_occurred_at.desc())
        ).limit(limit).offset(offset)
        result = await self._session.execute(list_stmt)
        return [(row[0], row[1]) for row in result.all()], total, page
