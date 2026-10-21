from datetime import datetime, timedelta, timezone

import httpx
import pytest

import app.services.token_service as token_service_module
from app.core.security import encrypt
from app.models.oauth_token import ECOAuthToken
from app.providers.base import ECAuthError, ECMaintenanceError
from app.providers.base_ec import BaseECProvider
from app.services.order_ingestion_service import OrderIngestionService
from app.services.token_service import (
    MaintenanceError,
    TokenRefreshError,
    TokenService,
    maintenance_error_from_response,
)

# 2026-10-21 21:57:00 UTC = 2026-10-22 06:57 JST
_END = 1792619820
_MAINTENANCE_BODY = {
    "error": "maintenance",
    "error_description": "現在サービスはメンテナンス中です。",
    "maintenance": {"start": 1792565400, "end": _END},
}


def test_parses_maintenance_response():
    err = maintenance_error_from_response(httpx.Response(400, json=_MAINTENANCE_BODY))

    assert err is not None
    assert err.end == datetime.fromtimestamp(_END, tz=timezone.utc)
    assert "2026-10-22 06:57" in str(err)


def test_treats_html_503_as_maintenance():
    html = "<html><head><title>503 Service Temporarily Unavailable</title></head></html>"
    err = maintenance_error_from_response(httpx.Response(503, text=html))

    assert err is not None
    assert err.end is None
    assert "HTTP 503" in str(err)
    assert "<html>" not in str(err)


def test_ignores_other_errors():
    assert maintenance_error_from_response(httpx.Response(400, json={"error": "invalid_grant"})) is None
    assert maintenance_error_from_response(httpx.Response(500, text="Internal Server Error")) is None
    assert maintenance_error_from_response(httpx.Response(200, json=_MAINTENANCE_BODY)) is None


class FakeSession:
    def __init__(self, token):
        self._token = token
        self.committed = False

    async def get(self, model, pk):
        return self._token

    async def commit(self):
        self.committed = True


def _near_expiry_token() -> ECOAuthToken:
    now = datetime.now(timezone.utc)
    return ECOAuthToken(
        shop_id=1,
        platform="base",
        access_token_encrypted=encrypt("old-access"),
        refresh_token_encrypted=encrypt("old-refresh"),
        access_token_expires_at=now + timedelta(seconds=30),
        refresh_token_expires_at=now + timedelta(days=10),
    )


def _patch_token_client(monkeypatch, response: httpx.Response):
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(lambda request: response)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(token_service_module.httpx, "AsyncClient", factory)


async def test_refresh_during_maintenance_raises_maintenance_error_and_keeps_token(monkeypatch):
    _patch_token_client(monkeypatch, httpx.Response(400, json=_MAINTENANCE_BODY))
    token = _near_expiry_token()
    session = FakeSession(token)

    with pytest.raises(MaintenanceError):
        await TokenService(session, shop_id=1).get_valid_access_token()

    # 再認証扱いにせず、保存済みトークンは書き換えない
    assert not session.committed


async def test_refresh_html_503_raises_maintenance_error_and_keeps_token(monkeypatch):
    _patch_token_client(monkeypatch, httpx.Response(503, text="<html>503 Service Temporarily Unavailable</html>"))
    session = FakeSession(_near_expiry_token())

    with pytest.raises(MaintenanceError):
        await TokenService(session, shop_id=1).get_valid_access_token()

    assert not session.committed


async def test_refresh_other_error_still_raises_token_refresh_error(monkeypatch):
    _patch_token_client(monkeypatch, httpx.Response(400, json={"error": "invalid_grant"}))

    with pytest.raises(TokenRefreshError):
        await TokenService(FakeSession(_near_expiry_token()), shop_id=1).get_valid_access_token()


class FakeTokenService:
    def __init__(self, exc: Exception | None = None):
        self._exc = exc

    async def get_valid_access_token(self) -> str:
        if self._exc:
            raise self._exc
        return "access"


def _provider(token_exc=None, response: httpx.Response | None = None) -> BaseECProvider:
    client = httpx.AsyncClient(
        base_url="https://api.example.test",
        transport=httpx.MockTransport(lambda request: response or httpx.Response(200, json={})),
    )
    return BaseECProvider(FakeTokenService(token_exc), client=client)


async def test_provider_maps_token_maintenance_to_ec_maintenance_error():
    provider = _provider(token_exc=MaintenanceError(datetime.fromtimestamp(_END, tz=timezone.utc)))

    with pytest.raises(ECMaintenanceError) as exc_info:
        await provider.list_orders(start_ordered=datetime.now(timezone.utc))
    assert exc_info.value.end == datetime.fromtimestamp(_END, tz=timezone.utc)


async def test_provider_still_maps_auth_error():
    provider = _provider(token_exc=TokenRefreshError("expired"))

    with pytest.raises(ECAuthError):
        await provider.list_orders(start_ordered=datetime.now(timezone.utc))


async def test_get_item_during_maintenance_is_not_treated_as_missing_item():
    provider = _provider(response=httpx.Response(400, json=_MAINTENANCE_BODY))

    with pytest.raises(ECMaintenanceError):
        await provider.get_item("123")


async def test_update_stock_during_maintenance_raises():
    provider = _provider(response=httpx.Response(400, json=_MAINTENANCE_BODY))

    with pytest.raises(ECMaintenanceError):
        await provider.update_stock("123", 5)


class MaintenanceProvider:
    async def list_orders(self, start_ordered, end_ordered=None):
        raise ECMaintenanceError("BASEがメンテナンス中です(終了予定: 不明)")


async def test_order_sync_skips_without_event_log():
    # sessionを渡さない: イベントログ(=通知)を書こうとすればAttributeErrorで落ちる
    service = OrderIngestionService(session=None, provider=MaintenanceProvider(), shop_id=1)

    result = await service.sync(start_ordered=datetime.now(timezone.utc))

    assert result.orders_seen == 0
    assert result.errors == ["BASEがメンテナンス中です(終了予定: 不明)"]
