import logging
from datetime import datetime, timezone

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.shop import Shop
from app.providers.factory import build_provider
from app.services.item_category_sync_service import ItemCategorySyncService
from app.services.shop_service import ShopService
from app.services.scheduler import scheduler

logger = logging.getLogger(__name__)

JOB_ID = "sync-item-categories"


async def _sync_item_categories_for_shop(session, shop: Shop) -> None:
    try:
        provider = build_provider(shop, session)
        count = await ItemCategorySyncService(session, provider, shop.id).sync()
        await session.commit()
        logger.info("ショップ%sの商品カテゴリを同期しました(%s件)", shop.id, count)
    except Exception:  # noqa: BLE001
        logger.exception("ショップ%sの商品カテゴリ同期中にエラーが発生しました", shop.id)
        await session.rollback()


async def sync_item_categories() -> None:
    async with AsyncSessionLocal() as session:
        shops = await ShopService(session).list_shops(active_only=True)
        for shop in shops:
            await _sync_item_categories_for_shop(session, shop)


async def sync_item_categories_for_shop_now(shop_id: int) -> None:
    """BASE連携完了直後に1ショップ分だけ即時同期する。既存の定期ジョブ(interval)とは
    独立して動く、リクエストのDBセッションに依存しない自己完結タスク。

    連携直後は「BOM設定済みだが注文はまだ無い」状態でも、対象商品(BomProductSetting
    参照)のカテゴリを先に埋めておくことで、直後に注文同期しても売上ページの
    カテゴリ別グラフがすぐ表示できるようにする。
    """
    async with AsyncSessionLocal() as session:
        try:
            shop = await ShopService(session).get_shop(shop_id)
        except Exception:  # noqa: BLE001
            logger.exception("ショップ%sの連携直後カテゴリ同期: ショップ取得に失敗しました", shop_id)
            return
        await _sync_item_categories_for_shop(session, shop)


def start_item_category_sync_scheduler() -> None:
    scheduler.add_job(
        sync_item_categories,
        "interval",
        hours=settings.item_category_sync_interval_hours,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )


def shutdown_item_category_sync_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
