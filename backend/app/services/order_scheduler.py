import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.shop import Shop
from app.providers.factory import build_provider
from app.services.app_setting_service import AppSettingService
from app.services.demo_seed_service import advance_demo_orders
from app.services.order_ingestion_service import IngestionResult, OrderIngestionService
from app.services.scheduler import scheduler
from app.services.shop_service import ShopService

logger = logging.getLogger(__name__)

ORDER_POLLER_ENABLED_KEY = "order_poller.enabled"
ORDER_POLLER_INTERVAL_KEY = "order_poller.interval_seconds"
ORDER_POLLER_GO_LIVE_KEY = "order_poller.go_live_at"
ORDER_POLLER_LAST_SYNCED_AT_KEY = "order_poller.last_synced_at"
DEFAULT_INTERVAL_SECONDS = 60
JOB_ID = "poll-orders"


async def run_sync_once_for_shop(session: AsyncSession, shop: Shop) -> IngestionResult:
    """1ショップ分の同期処理。ポーリングjob・手動同期エンドポイントの両方から呼ばれる。"""
    setting_service = AppSettingService(session)
    # go_live_atはショップごとに上書きできるが、設定画面の「運用開始日時」欄は共通設定
    # (`order_poller.go_live_at`、ショップ接尾辞なし)にしか書き込まないため、ショップ専用の
    # 上書きが無ければ必ず共通設定にフォールバックする(get_value_with_shop_fallback)。
    # 以前はショップ専用キーのみを見ていたため、どのショップにも一致する設定が存在せず、
    # 毎回now()にフォールバックしてしまい、既存の注文が一切取り込まれないバグがあった
    go_live_raw = await setting_service.get_value_with_shop_fallback(ORDER_POLLER_GO_LIVE_KEY, shop.id, "")
    go_live_at = datetime.fromisoformat(go_live_raw) if go_live_raw else datetime.now(timezone.utc)

    provider = build_provider(shop, session)
    ingestion = OrderIngestionService(session, provider, shop.id)
    watermark = await ingestion.compute_watermark(go_live_at=go_live_at)
    result = await ingestion.sync(start_ordered=watermark)
    if settings.demo_mode:
        # デモモードはBASEへ実通信しないため本来の同期は何もしない。ピッキング完了済み
        # 注文の自動発送(実在庫消費)と、未対応注文が尽きた場合のランダム補充を代わりに行う
        await advance_demo_orders(session, shop, result)
    # ヘッダーの連携ステータス表示に「最終同期時刻」として出す。同期が成功して完了した
    # (例外にならなかった)時点で記録すればよく、EC側の一時的なエラーはresult.errorsに
    # 個別記録されるため、ここでは区別しない
    await setting_service.set(
        f"{ORDER_POLLER_LAST_SYNCED_AT_KEY}.{shop.id}", datetime.now(timezone.utc).isoformat()
    )
    return result


async def run_sync_once(session: AsyncSession) -> IngestionResult:
    """アクティブな全ショップを同期する(手動同期エンドポイント用の入り口)。

    1ショップの失敗(未実装プラットフォームのNotImplementedError等)が他ショップの同期を
    止めないよう、ショップごとに独立してエラーを捕捉する。
    """
    combined = IngestionResult()
    shops = await ShopService(session).list_shops(active_only=True)
    for shop in shops:
        try:
            result = await run_sync_once_for_shop(session, shop)
        except Exception as e:  # noqa: BLE001
            logger.exception("ショップ %s (id=%s) の注文同期に失敗しました", shop.name, shop.id)
            combined.errors.append(f"{shop.name}: {e}")
            continue
        combined.orders_seen += result.orders_seen
        combined.new_orders += result.new_orders
        combined.transitioned_orders += result.transitioned_orders
        combined.errors.extend(result.errors)
    return combined


async def poll_orders() -> None:
    async with AsyncSessionLocal() as session:
        setting_service = AppSettingService(session)
        enabled = await setting_service.get_value(ORDER_POLLER_ENABLED_KEY, "true")
        if enabled != "true":
            return

        result = await run_sync_once(session)
        if result.errors:
            logger.warning("注文同期でエラーが発生しました: %s", result.errors)


def reschedule_interval(seconds: int) -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.reschedule_job(JOB_ID, trigger="interval", seconds=seconds)


async def start_order_scheduler() -> None:
    async with AsyncSessionLocal() as session:
        setting_service = AppSettingService(session)
        # 初回起動時のみtrueを既定値として書き込む(ユーザーが一度でも明示的にオフにした後は
        # 上書きしない)。設定画面のトグル表示もこの実データに基づくため、フォールバック値を
        # 変えるだけでなく実際に行を作っておかないとUI上は「オフ」に見えてしまう
        await setting_service.set_default(ORDER_POLLER_ENABLED_KEY, "true")
        interval_raw = await setting_service.get_value(ORDER_POLLER_INTERVAL_KEY, str(DEFAULT_INTERVAL_SECONDS))
    interval = int(interval_raw)

    scheduler.add_job(
        poll_orders,
        "interval",
        seconds=interval,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )


def shutdown_order_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
