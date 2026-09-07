from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_log import EventLog
from app.models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from app.models.stock_movement import StockMovement
from app.models.stock_schedule import ScheduleStatus, StockSchedule
from app.services.app_setting_service import AppSettingService

ORDERS_DAYS_KEY = "retention.orders_days"
PURCHASE_ORDERS_DAYS_KEY = "retention.purchase_orders_days"
STOCK_SCHEDULES_DAYS_KEY = "retention.stock_schedules_days"
STOCK_MOVEMENTS_DAYS_KEY = "retention.stock_movements_days"
EVENT_LOGS_DAYS_KEY = "retention.event_logs_days"

_PURCHASE_ORDER_FINAL_STATUSES = (PurchaseOrderStatus.RECEIVED.value, PurchaseOrderStatus.CANCELLED.value)
_SCHEDULE_FINAL_STATUSES = (ScheduleStatus.SUCCESS.value, ScheduleStatus.FAILED.value, ScheduleStatus.CANCELLED.value)


class RetentionService:
    """設定された保持日数を過ぎた「完了済み」のトランザクションデータを削除する。

    未対応の注文・未入荷の発注・pending/runningのスケジュールなど進行中のデータは、
    経過日数に関わらず削除しない。各カテゴリの保持日数はAppSettingで管理し、
    未設定(空文字・0以下)の場合はそのカテゴリの自動削除を行わない(デフォルトは無効)。
    """

    def __init__(self, session: AsyncSession):
        self._session = session
        self._setting_service = AppSettingService(session)

    async def _get_days(self, key: str) -> int | None:
        raw = await self._setting_service.get_value(key, "")
        if not raw:
            return None
        try:
            days = int(raw)
        except ValueError:
            return None
        return days if days > 0 else None

    async def cleanup_orders(self) -> int:
        """一時的に無効化している(2026-09-04)。

        orders/order_items/order_item_options/order_part_reservationsは、注文単位・
        商品単位の売上高/原価(将来対応)を計算できる唯一の元データであり、経理帳簿と
        同じ性質を持つ経営情報である。一方で本来削除したいのは氏名・住所・メールアドレスの
        個人情報のみで、行ごと物理削除するとこれらの経営情報も道連れで永久に失われてしまう
        (再現不可能)。個人情報だけを匿名化する方式に置き換えるまで、注文データの自動削除は
        行わない(retention.orders_daysが設定されていても無視する)。
        """
        return 0

    async def cleanup_purchase_orders(self) -> int:
        days = await self._get_days(PURCHASE_ORDERS_DAYS_KEY)
        if days is None:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self._session.execute(
            delete(PurchaseOrder).where(
                PurchaseOrder.status.in_(_PURCHASE_ORDER_FINAL_STATUSES),
                PurchaseOrder.ordered_at < cutoff,
            )
        )
        return result.rowcount or 0

    async def cleanup_stock_schedules(self) -> int:
        days = await self._get_days(STOCK_SCHEDULES_DAYS_KEY)
        if days is None:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self._session.execute(
            delete(StockSchedule).where(
                StockSchedule.status.in_(_SCHEDULE_FINAL_STATUSES),
                StockSchedule.run_at < cutoff,
            )
        )
        return result.rowcount or 0

    async def cleanup_stock_movements(self) -> int:
        days = await self._get_days(STOCK_MOVEMENTS_DAYS_KEY)
        if days is None:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self._session.execute(delete(StockMovement).where(StockMovement.created_at < cutoff))
        return result.rowcount or 0

    async def cleanup_event_logs(self) -> int:
        days = await self._get_days(EVENT_LOGS_DAYS_KEY)
        if days is None:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self._session.execute(delete(EventLog).where(EventLog.created_at < cutoff))
        return result.rowcount or 0

    async def run_all(self) -> dict[str, int]:
        counts = {
            "orders": await self.cleanup_orders(),
            "purchase_orders": await self.cleanup_purchase_orders(),
            "stock_schedules": await self.cleanup_stock_schedules(),
            "stock_movements": await self.cleanup_stock_movements(),
            "event_logs": await self.cleanup_event_logs(),
        }
        await self._session.commit()
        return counts
