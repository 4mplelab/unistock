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

    async def refresh(self, obj):
        pass

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


# --- 再認証待ちの状態・同時更新の排他 ---

import asyncio

import httpx

import app.services.token_service as token_service_module


def _patch_token_endpoint(monkeypatch, handler):
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(token_service_module.httpx, "AsyncClient", factory)


async def test_refresh_failure_marks_reauth_required_and_stops_calling_base(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(400, json={"error": "invalid_request"})

    _patch_token_endpoint(monkeypatch, handler)
    token = make_token(timedelta(seconds=30), timedelta(days=10))
    service = TokenService(FakeSession(token), shop_id=1)

    with pytest.raises(TokenRefreshError) as first:
        await service.get_valid_access_token()
    assert first.value.newly_required
    assert token.reauth_required_at is not None

    with pytest.raises(TokenRefreshError) as second:
        await service.get_valid_access_token()
    assert not second.value.newly_required
    assert len(calls) == 1


async def test_expired_refresh_token_is_notified_only_once():
    token = make_token(timedelta(seconds=30), timedelta(days=-1))
    service = TokenService(FakeSession(token), shop_id=1)

    with pytest.raises(TokenRefreshError) as first:
        await service.get_valid_access_token()
    with pytest.raises(TokenRefreshError) as second:
        await service.get_valid_access_token()

    assert first.value.newly_required
    assert not second.value.newly_required


async def test_exchange_code_clears_reauth_required(monkeypatch):
    _patch_token_endpoint(
        monkeypatch,
        lambda request: httpx.Response(
            200, json={"access_token": "a", "refresh_token": "r", "expires_in": 3600, "scope": "read_orders"}
        ),
    )
    token = make_token(timedelta(seconds=30), timedelta(days=10))
    token.reauth_required_at = datetime.now(timezone.utc)

    await TokenService(FakeSession(token), shop_id=1).exchange_code("code")

    assert token.reauth_required_at is None


async def test_concurrent_callers_refresh_only_once(monkeypatch):
    calls = []

    async def handler(request):
        calls.append(request)
        await asyncio.sleep(0.01)
        return httpx.Response(200, json={"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600})

    _patch_token_endpoint(monkeypatch, handler)
    # 同じトークン行を共有する(DBから読み直した結果と同じ状態になる)
    token = make_token(timedelta(seconds=30), timedelta(days=10))
    token.shop_id = 99

    results = await asyncio.gather(
        TokenService(FakeSession(token), shop_id=99).get_valid_access_token(),
        TokenService(FakeSession(token), shop_id=99).get_valid_access_token(),
    )

    assert results == ["new-access", "new-access"]
    assert len(calls) == 1
