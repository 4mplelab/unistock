from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import encrypt
from app.models.oauth_token import ECOAuthToken
from app.services.token_service import TokenRefreshError, TokenService


class FakeSession:
    """DBを使わずTokenServiceの期限判定ロジックのみを検証するためのスタブ"""

    def __init__(self, token: ECOAuthToken | None):
        self._token = token

    async def get(self, model, pk):
        return self._token

    async def commit(self):
        pass


def make_token(access_delta: timedelta, refresh_delta: timedelta) -> ECOAuthToken:
    now = datetime.now(timezone.utc)
    return ECOAuthToken(
        shop_id=1,
        platform="base",
        access_token_encrypted=encrypt("cached-access-token"),
        refresh_token_encrypted=encrypt("cached-refresh-token"),
        access_token_expires_at=now + access_delta,
        refresh_token_expires_at=now + refresh_delta,
    )


async def test_returns_cached_access_token_when_not_near_expiry():
    token = make_token(timedelta(minutes=30), timedelta(days=10))
    service = TokenService(FakeSession(token), shop_id=1)

    result = await service.get_valid_access_token()

    assert result == "cached-access-token"


async def test_raises_when_no_token_registered():
    service = TokenService(FakeSession(None), shop_id=1)

    with pytest.raises(TokenRefreshError):
        await service.get_valid_access_token()


async def test_raises_when_refresh_token_expired_and_access_token_near_expiry():
    # access_tokenが2分未満で期限切れ間近、かつrefresh_tokenも既に期限切れのケース
    token = make_token(timedelta(seconds=30), timedelta(days=-1))
    service = TokenService(FakeSession(token), shop_id=1)

    with pytest.raises(TokenRefreshError):
        await service.get_valid_access_token()
