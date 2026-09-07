import logging

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.order import DispatchStatus, Order
from app.providers.factory import build_provider
from app.services.order_ingestion_service import IngestionResult, OrderIngestionService
from app.services.scheduler import scheduler
from app.services.shop_service import ShopService

logger = logging.getLogger(__name__)

JOB_ID = "recheck-order-status"

_FINAL_STATUSES = (DispatchStatus.DISPATCHED.value, DispatchStatus.CANCELLED.value)


async def recheck_order_status() -> None:
    async with AsyncSessionLocal() as session:
        # 対象は進行中の注文のみ。sync()のwatermarkが進んで再取得対象から外れてしまった
        # 古い注文でも、ここではunique_key指定で個別に最新状態を取りに行くため影響を受けない
        order_ids_result = await session.execute(
            select(Order.id).where(Order.dispatch_status.notin_(_FINAL_STATUSES))
        )
        order_ids = list(order_ids_result.scalars().all())
        if not order_ids:
            return

        result = IngestionResult()
        # ショップをまたいで対象注文が混在しうるため、ショップごとにプロバイダ/取り込みサービスを
        # 遅延生成してキャッシュする(1ショップのエラーが他ショップのリチェックを止めないよう、
        # 注文単位のtry/exceptはそのまま維持する)
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
                await ingestions[order.shop_id].recheck_status(order, result)
            except Exception:  # noqa: BLE001
                logger.exception("注文 %s の状態リチェック中にエラーが発生しました", order.unique_key)
                await session.rollback()

        if result.errors:
            logger.warning("注文状態リチェックでエラーが発生しました: %s", result.errors)


def start_order_status_recheck_scheduler() -> None:
    # order_poller.enabledの設定に関わらず常時動く独立ジョブ。sync()のwatermark制限により
    # 古い進行中の注文がポーリング・手動同期の対象から外れてしまっても、連携先の状態変化
    # (発送確定等)を追いつけるようにする
    scheduler.add_job(
        recheck_order_status,
        "interval",
        seconds=settings.order_status_recheck_interval_seconds,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )


def shutdown_order_status_recheck_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
