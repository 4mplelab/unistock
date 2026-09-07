from datetime import datetime
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.oauth_token import ECOAuthToken
from app.schemas.oauth import AuthorizeUrlResponse, ExchangeCodeRequest, OAuthStatusResponse
from app.services.app_setting_service import AppSettingService
from app.services.auth_service import require_admin, require_auth
from app.services.order_scheduler import ORDER_POLLER_LAST_SYNCED_AT_KEY
from app.services.shop_service import ShopNotFoundError, ShopService
from app.services.token_service import TokenRefreshError, TokenService

router = APIRouter(prefix="/api/oauth/shops/{shop_id}", tags=["oauth"], dependencies=[Depends(require_auth)])


async def _get_shop_or_404(shop_id: int, session: AsyncSession):
    try:
        return await ShopService(session).get_shop(shop_id)
    except ShopNotFoundError as e:
        raise HTTPException(status_code=404, detail="ショップが見つかりません") from e


@router.get("/authorize-url", response_model=AuthorizeUrlResponse, dependencies=[Depends(require_admin)])
async def get_authorize_url(shop_id: int, session: AsyncSession = Depends(get_db)) -> AuthorizeUrlResponse:
    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="デモモードではこの操作はできません")
    shop = await _get_shop_or_404(shop_id, session)
    if shop.platform != "base":
        raise HTTPException(status_code=400, detail=f"{shop.platform}のOAuth連携は未実装です")

    params = {
        "response_type": "code",
        "client_id": settings.base_client_id,
        "redirect_uri": settings.base_redirect_uri,
        "scope": "read_items write_items read_orders",
        # BASE側の認可画面から戻ってきた際、どのショップへの認可コードかをフロントで
        # 突き合わせられるようにstateにshop_idを載せておく
        "state": str(shop_id),
    }
    # BASE APIはscopeのスペースを%20エンコード必須(quote_plusの'+'は不可)
    url = f"{settings.base_api_base_url}/1/oauth/authorize?{urlencode(params, quote_via=quote)}"
    return AuthorizeUrlResponse(url=url)


@router.post("/exchange-code", response_model=OAuthStatusResponse, dependencies=[Depends(require_admin)])
async def exchange_code(
    shop_id: int, body: ExchangeCodeRequest, session: AsyncSession = Depends(get_db)
) -> OAuthStatusResponse:
    # デモモード中は本物のBASE連携トークンが絶対に発行されない、という前提を守るためのガード。
    # デモモードはrequire_admin自体をバイパスするため、UIでボタンを隠すだけでは
    # 第三者がAPIを直接叩いて本物の連携を成立させてしまう可能性がある
    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="デモモードではこの操作はできません")
    await _get_shop_or_404(shop_id, session)

    service = TokenService(session, shop_id)
    try:
        token = await service.exchange_code(body.code)
    except TokenRefreshError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return OAuthStatusResponse(
        authenticated=True,
        access_token_expires_at=token.access_token_expires_at,
        refresh_token_expires_at=token.refresh_token_expires_at,
        scope=token.scope,
    )


async def _get_last_synced_at(session: AsyncSession, shop_id: int) -> datetime | None:
    setting_service = AppSettingService(session)
    raw = await setting_service.get_value(f"{ORDER_POLLER_LAST_SYNCED_AT_KEY}.{shop_id}", "")
    return datetime.fromisoformat(raw) if raw else None


@router.get("/status", response_model=OAuthStatusResponse)
async def get_status(shop_id: int, session: AsyncSession = Depends(get_db)) -> OAuthStatusResponse:
    await _get_shop_or_404(shop_id, session)
    token = await session.get(ECOAuthToken, shop_id)
    last_synced_at = await _get_last_synced_at(session, shop_id)
    if token is None:
        return OAuthStatusResponse(authenticated=False, last_synced_at=last_synced_at)

    return OAuthStatusResponse(
        authenticated=True,
        access_token_expires_at=token.access_token_expires_at,
        refresh_token_expires_at=token.refresh_token_expires_at,
        scope=token.scope,
        last_synced_at=last_synced_at,
    )


@router.delete("/connection", status_code=204, dependencies=[Depends(require_admin)])
async def disconnect(shop_id: int, session: AsyncSession = Depends(get_db)) -> None:
    await _get_shop_or_404(shop_id, session)
    token = await session.get(ECOAuthToken, shop_id)
    if token is not None:
        await session.delete(token)
        await session.commit()
