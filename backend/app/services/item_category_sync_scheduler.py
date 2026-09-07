import logging

from app.config import settings
from app.database import AsyncSessionLocal
from app.providers.factory import build_provider
from app.services.item_category_sync_service import ItemCategorySyncService
from app.services.scheduler import scheduler
from app.services.shop_service import ShopService

logger = logging.getLogger(__name__)

JOB_ID = "sync-item-categories"


async def sync_item_categories() -> None:
    async with AsyncSessionLocal() as session:
        shops = await ShopService(session).list_shops(active_only=True)
        for shop in shops:
            try:
                provider = build_provider(shop, session)
                count = await ItemCategorySyncService(session, provider, shop.id).sync()
                await session.commit()
                logger.info("ショップ%sの商品カテゴリを同期しました(%s件)", shop.id, count)
            except Exception:  # noqa: BLE001
                logger.exception("ショップ%sの商品カテゴリ同期中にエラーが発生しました", shop.id)
                await session.rollback()


def start_item_category_sync_scheduler() -> None:
    scheduler.add_job(
        sync_item_categories,
        "interval",
        hours=settings.item_category_sync_interval_hours,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )


def shutdown_item_category_sync_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
