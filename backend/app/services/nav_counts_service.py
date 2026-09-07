from datetime import datetime

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_log import EventLog, EventLogLevel
from app.models.order import DispatchStatus, Order, OrderItem
from app.models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from app.models.stock_schedule import ScheduleStatus, StockSchedule
from app.schemas.nav_counts import NavCountsRead


async def get_nav_counts(
    session: AsyncSession, event_logs_since: datetime | None = None, shop_id: int | None = None
) -> NavCountsRead:
    """event_logs_errorは「エラーの総数」ではなく「最後にイベントログ画面を開いて以降に
    増えたエラー件数」を表す(既読管理はフロント側でブラウザごとに行い、その最終閲覧時刻を
    ここに渡す)。他の件数(注文・ピッキング・リストック予約・発注)は既読の概念を持たない
    実際の未対応/未処理件数のため、常に現在値を返す。

    shop_idを渡すと、ショップに紐づく件数(注文・ピッキング・リストック予約)をそのショップの
    ものだけに絞り込む。event_logs_errorはEventLogがshop_id非依存の共有データを含むため
    対象外(常に全ショップ合算)。purchase_orders_orderedも、発注対象の部品在庫自体が
    全ショップ共有のため対象外とし、常に全ショップ合算の件数を返す
    (どのショップが発注したかはPurchaseOrder.shop_idに記録されるが、絞り込みには使わない)。
    """
    orders_query = select(func.count()).select_from(Order).where(Order.dispatch_status == DispatchStatus.ORDERED.value)
    if shop_id is not None:
        orders_query = orders_query.where(Order.shop_id == shop_id)
    orders_unaddressed = (await session.execute(orders_query)).scalar_one()

    # 未対応の注文のうち、未ピッキング(picked=false)の明細を1件以上持つ注文数
    picking_query = (
        select(func.count(distinct(Order.id)))
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.dispatch_status == DispatchStatus.ORDERED.value, OrderItem.picked.is_(False))
    )
    if shop_id is not None:
        picking_query = picking_query.where(Order.shop_id == shop_id)
    picking_incomplete = (await session.execute(picking_query)).scalar_one()

    event_logs_query = select(func.count()).select_from(EventLog).where(EventLog.level == EventLogLevel.ERROR.value)
    if event_logs_since is not None:
        event_logs_query = event_logs_query.where(EventLog.created_at > event_logs_since)
    event_logs_error = (await session.execute(event_logs_query)).scalar_one()

    schedules_query = (
        select(func.count()).select_from(StockSchedule).where(StockSchedule.status == ScheduleStatus.PENDING.value)
    )
    if shop_id is not None:
        schedules_query = schedules_query.where(StockSchedule.shop_id == shop_id)
    schedules_pending = (await session.execute(schedules_query)).scalar_one()

    purchase_orders_query = (
        select(func.count()).select_from(PurchaseOrder).where(PurchaseOrder.status == PurchaseOrderStatus.ORDERED.value)
    )
    purchase_orders_ordered = (await session.execute(purchase_orders_query)).scalar_one()

    return NavCountsRead(
        orders_unaddressed=orders_unaddressed,
        picking_incomplete=picking_incomplete,
        event_logs_error=event_logs_error,
        schedules_pending=schedules_pending,
        purchase_orders_ordered=purchase_orders_ordered,
    )
