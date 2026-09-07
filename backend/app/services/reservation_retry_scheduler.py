import logging

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.order import DispatchStatus, Order, OrderItem
from app.providers.factory import build_provider
from app.services.order_ingestion_service import IngestionResult, OrderIngestionService
from app.services.scheduler import scheduler
from app.services.shop_service import ShopService

logger = logging.getLogger(__name__)

JOB_ID = "retry-pending-reservations"

_FINAL_STATUSES = (DispatchStatus.DISPATCHED.value, DispatchStatus.CANCELLED.value)


async def retry_pending_reservations() -> None:
    async with AsyncSessionLocal() as session:
        # 対象は進行中の注文のみ。発送/キャンセル確定済みの注文は、BOMが後から整備されても
        # 遡って補正しない方針のため、ここで最初から除外する(_reserve内部にも同じガードがあるが、
        # 無駄なクエリを繰り返さないためここでも絞り込む)
        order_ids_result = await session.execute(
            select(OrderItem.order_id)
            .join(Order, Order.id == OrderItem.order_id)
            .where(OrderItem.reservation_applied.is_(False), Order.dispatch_status.notin_(_FINAL_STATUSES))
            .distinct()
        )
        order_ids = list(order_ids_result.scalars().all())
        if not order_ids:
            return

        result = IngestionResult()
        # ショップをまたいで対象注文が混在しうるため、ショップごとにプロバイダ/取り込みサービスを
        # 遅延生成してキャッシュする
        shop_service = ShopService(session)
        ingestions: dict[int, OrderIngestionService] = {}

        for order_id in order_ids:
            order = await session.get(Order, order_id)
            if order is None:
                continue
            try:
                if order.shop_id not in ingestions:
                    shop = await shop_service.get_shop(order.shop_id)
                    provider = build_provider(shop, session)
                    ingestions[order.shop_id] = OrderIngestionService(session, provider, shop.id)
                await ingestions[order.shop_id].retry_reservation(order, result)
            except Exception:  # noqa: BLE001
                logger.exception("注文 %s の引当リトライ中にエラーが発生しました", order.unique_key)
                await session.rollback()

        if result.errors:
            logger.warning("引当リトライでエラーが発生しました: %s", result.errors)


def start_reservation_retry_scheduler() -> None:
    # order_poller.enabledの設定に関わらず常時動く独立ジョブ。BOM未設定等で保留中の部品引当が
    # 後から解消された場合に、ポーリングがOFFでも・誰も「今すぐ同期」を押さなくても追いつけるようにする
    scheduler.add_job(
        retry_pending_reservations,
        "interval",
        seconds=settings.reservation_retry_interval_seconds,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )


def shutdown_reservation_retry_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
