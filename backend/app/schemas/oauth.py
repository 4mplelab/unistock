from datetime import datetime

from pydantic import BaseModel


class AuthorizeUrlResponse(BaseModel):
    url: str


class ExchangeCodeRequest(BaseModel):
    code: str


class OAuthStatusResponse(BaseModel):
    authenticated: bool
    access_token_expires_at: datetime | None = None
    refresh_token_expires_at: datetime | None = None
    scope: str | None = None
    # トークン更新に失敗し、再認証が必要な状態
    reauth_required: bool = False
    # order_poller/手動同期どちらでも、直近で同期処理が完了した時刻(app_settingsに記録)
    last_synced_at: datetime | None = None
