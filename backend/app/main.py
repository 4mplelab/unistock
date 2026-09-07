import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings as app_settings
from app.database import AsyncSessionLocal
from app.logging_config import configure_logging
from app.routers import (
    allowed_users,
    api_keys,
    assemblies,
    auth,
    bom,
    data_reset,
    event_logs,
    health,
    items,
    manual_items,
    manual_order_import_profiles,
    manual_orders,
    nav_counts,
    oauth,
    orders,
    parts,
    purchase_orders,
    sales,
    schedules,
    settings,
    shops,
    stock_movements,
    version,
)
from app.core.security import init_fernet_key
from app.services.auth_service import ensure_token_encryption_key, seed_initial_admin
from app.services.demo_mode_state import sync_demo_mode_state
from app.services.item_category_sync_scheduler import (
    shutdown_item_category_sync_scheduler,
    start_item_category_sync_scheduler,
)
from app.services.notification_scheduler import shutdown_notification_scheduler, start_notification_scheduler
from app.services.order_scheduler import shutdown_order_scheduler, start_order_scheduler
from app.services.order_status_recheck_scheduler import (
    shutdown_order_status_recheck_scheduler,
    start_order_status_recheck_scheduler,
)
from app.services.reservation_retry_scheduler import (
    shutdown_reservation_retry_scheduler,
    start_reservation_retry_scheduler,
)
from app.services.retention_scheduler import shutdown_retention_scheduler, start_retention_scheduler
from app.services.scheduler import shutdown_scheduler, start_scheduler

configure_logging()
logger = logging.getLogger(__name__)

if app_settings.demo_mode:
    logger.warning(
        "=== DEMO MODE ENABLED === 認証なし・外部ショップ接続なしで動作します。"
        "本番投入前に必ずDEMO_MODEをfalseに戻し、デモデータをクリアしてください"
    )

# OAuthのstate/PKCE検証をAuthlibが保存するためのセッション。
# 未設定なら起動ごとのランダム値にフォールバック(再起動でハンドシェイク中のログインは失効するだけで実害はない)
_OAUTH_HANDSHAKE_SECRET = app_settings.session_secret_key or secrets.token_urlsafe(32)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSessionLocal() as session:
        init_fernet_key(await ensure_token_encryption_key(session))
        await seed_initial_admin(session)
        await sync_demo_mode_state(session)
    start_scheduler()
    start_reservation_retry_scheduler()
    # デモモードでは、外部ショップへの実通信を行うジョブ(注文ポーリング・注文再確認)と
    # 保持期間経過データの自動削除ジョブは起動しない。前者は外部接続を持たないため
    # 意味がなく、後者はdemo_seed_serviceが作り込んだ過去日付のデモデータを
    # 消してしまい、デモの一貫性を壊すため
    if not app_settings.demo_mode:
        await start_order_scheduler()
        start_retention_scheduler()
        start_order_status_recheck_scheduler()
        start_item_category_sync_scheduler()
        # 通知チェック自体は内部データだけを見るためデモモードでも動作しうるが、デモデータに
        # 対して実際のWebhook/メールが飛ぶと紛らわしいため、他の実通信系ジョブと同様に
        # デモモードでは起動しない
        start_notification_scheduler()
    yield
    if not app_settings.demo_mode:
        shutdown_notification_scheduler()
        shutdown_item_category_sync_scheduler()
        shutdown_order_status_recheck_scheduler()
        shutdown_retention_scheduler()
        shutdown_order_scheduler()
    shutdown_reservation_retry_scheduler()
    shutdown_scheduler()


app = FastAPI(title="UniStock API", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=_OAUTH_HANDSHAKE_SECRET,
    session_cookie="unistock_oauth_handshake",
    same_site="lax",
    https_only=app_settings.backend_base_url.startswith("https://"),
)

app.include_router(health.router, prefix="/api")
app.include_router(oauth.router)
app.include_router(auth.router)
app.include_router(allowed_users.router)
app.include_router(api_keys.router)
app.include_router(schedules.router)
app.include_router(items.router)
app.include_router(manual_items.router)
app.include_router(manual_orders.router)
app.include_router(manual_order_import_profiles.router)
app.include_router(settings.router)
app.include_router(shops.router)
app.include_router(parts.router)
app.include_router(assemblies.router)
app.include_router(bom.router)
app.include_router(orders.router)
app.include_router(purchase_orders.router)
app.include_router(sales.router)
app.include_router(data_reset.router)
app.include_router(event_logs.router)
app.include_router(stock_movements.router)
app.include_router(nav_counts.router)
app.include_router(version.router)
