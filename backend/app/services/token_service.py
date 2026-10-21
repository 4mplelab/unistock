from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import decrypt, encrypt
from app.models.oauth_token import ECOAuthToken

ACCESS_TOKEN_REFRESH_MARGIN = timedelta(minutes=2)
REFRESH_TOKEN_LIFETIME = timedelta(days=30)


_JST = timezone(timedelta(hours=9))


class TokenRefreshError(Exception):
    """再認証が必要な場合に送出する"""


class MaintenanceError(Exception):
    """BASEがメンテナンス中。再認証は不要で、終了後に再試行すれば回復する"""

    def __init__(self, end: datetime | None):
        self.end = end
        end_text = end.astimezone(_JST).strftime("%Y-%m-%d %H:%M") if end else "不明"
        super().__init__(f"BASEがメンテナンス中です(終了予定: {end_text})")


def maintenance_error_from_response(resp: httpx.Response) -> MaintenanceError | None:
    """BASEのメンテナンス応答({"error": "maintenance", "maintenance": {"start", "end"}})なら
    MaintenanceErrorを返す。それ以外はNone。"""
    if resp.status_code == 200:
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    if not isinstance(body, dict) or body.get("error") != "maintenance":
        return None
    maintenance = body.get("maintenance")
    raw_end = maintenance.get("end") if isinstance(maintenance, dict) else None
    end = datetime.fromtimestamp(raw_end, tz=timezone.utc) if isinstance(raw_end, (int, float)) else None
    return MaintenanceError(end)


class TokenService:
    def __init__(self, session: AsyncSession, shop_id: int):
        self._session = session
        self._shop_id = shop_id

    async def get_valid_access_token(self) -> str:
        token = await self._session.get(ECOAuthToken, self._shop_id)
        if token is None:
            raise TokenRefreshError("BASE未認証です。初回OAuth認証を行ってください。")

        now = datetime.now(timezone.utc)
        if token.access_token_expires_at - now > ACCESS_TOKEN_REFRESH_MARGIN:
            return decrypt(token.access_token_encrypted)

        if token.refresh_token_expires_at <= now:
            raise TokenRefreshError("refresh_tokenが期限切れです(30日)。再認証してください。")

        return await self._refresh(token)

    async def _refresh(self, token: ECOAuthToken) -> str:
        async with httpx.AsyncClient(base_url=settings.base_api_base_url, timeout=10.0) as client:
            resp = await client.post(
                "/1/oauth/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": settings.base_client_id,
                    "client_secret": settings.base_client_secret,
                    "refresh_token": decrypt(token.refresh_token_encrypted),
                    # BASE仕様上、refresh_token grantでもredirect_uriは必須
                    "redirect_uri": settings.base_redirect_uri,
                },
            )
        if resp.status_code != 200:
            # メンテナンス中の応答は認証の問題ではないため、再認証扱いにしない
            # (refresh_tokenは未使用のまま有効なので、終了後にそのまま更新できる)
            maintenance = maintenance_error_from_response(resp)
            if maintenance is not None:
                raise maintenance
            raise TokenRefreshError(f"トークン更新に失敗しました: {resp.status_code} {resp.text}")

        data = resp.json()
        now = datetime.now(timezone.utc)
        # BASEはリフレッシュのたびに新しいrefresh_tokenを発行するため必ず上書きする
        token.access_token_encrypted = encrypt(data["access_token"])
        token.refresh_token_encrypted = encrypt(data["refresh_token"])
        token.access_token_expires_at = now + timedelta(seconds=data["expires_in"])
        token.refresh_token_expires_at = now + REFRESH_TOKEN_LIFETIME
        await self._session.commit()
        return data["access_token"]

    async def exchange_code(self, code: str) -> ECOAuthToken:
        async with httpx.AsyncClient(base_url=settings.base_api_base_url, timeout=10.0) as client:
            resp = await client.post(
                "/1/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.base_client_id,
                    "client_secret": settings.base_client_secret,
                    "code": code,
                    "redirect_uri": settings.base_redirect_uri,
                },
            )
        if resp.status_code != 200:
            maintenance = maintenance_error_from_response(resp)
            if maintenance is not None:
                raise maintenance
            raise TokenRefreshError(f"認可コードの交換に失敗しました: {resp.status_code} {resp.text}")

        data = resp.json()
        now = datetime.now(timezone.utc)

        token = await self._session.get(ECOAuthToken, self._shop_id)
        if token is None:
            token = ECOAuthToken(shop_id=self._shop_id, platform="base")
            self._session.add(token)

        token.access_token_encrypted = encrypt(data["access_token"])
        token.refresh_token_encrypted = encrypt(data["refresh_token"])
        token.access_token_expires_at = now + timedelta(seconds=data["expires_in"])
        token.refresh_token_expires_at = now + REFRESH_TOKEN_LIFETIME
        token.scope = data.get("scope")
        await self._session.commit()
        return token
