from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event_log import EventLog
from app.models.order import Order
from app.services.notification_service import notify

# イベントベースの通知対象(状態ベースのreorder_threshold/po_overdue/buildable_thresholdとは
# 別系統、notification_check_service.py参照)。この2カテゴリはEventLogService.log()の
# 呼び出しそのものが「1回の実際の発生」を表すため、dedup無しでその都度通知してよい
_NOTIFIABLE_CATEGORIES = {"auth_error", "stock_operation_failed"}

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

        category が auth_error / stock_operation_failed の場合、通知(Webhook/メール)も
        あわせて送る(デモモードでは実データではないため送らない)。
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

        self._session.add(
            EventLog(
                category=category, level=level, message=message, order_id=order_id, item_id=item_id, shop_id=shop_id
            )
        )
        await self._session.commit()

        if not settings.demo_mode and level in ("warning", "error") and category in _NOTIFIABLE_CATEGORIES:
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
