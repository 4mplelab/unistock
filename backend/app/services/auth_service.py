import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.auth import AllowedUser, ApiKey, LoginSession
from app.services.app_setting_service import AppSettingService

SESSION_COOKIE_NAME = "unistock_session"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_session(session: AsyncSession, allowed_user_id: int, provider: str) -> str:
    session_id = secrets.token_urlsafe(32)
    expires_at = _now() + timedelta(days=settings.session_ttl_days)
    session.add(
        LoginSession(id=session_id, allowed_user_id=allowed_user_id, provider=provider, expires_at=expires_at)
    )
    await session.commit()
    return session_id


async def delete_session(session: AsyncSession, session_id: str) -> None:
    login_session = await session.get(LoginSession, session_id)
    if login_session is not None:
        await session.delete(login_session)
        await session.commit()


async def _lookup_session(session: AsyncSession, session_id: str) -> AllowedUser | None:
    login_session = await session.get(LoginSession, session_id)
    if login_session is None:
        return None
    if login_session.expires_at < _now():
        await session.delete(login_session)
        await session.commit()
        return None
    login_session.last_seen_at = _now()
    await session.commit()
    return await session.get(AllowedUser, login_session.allowed_user_id)


def generate_api_key() -> tuple[str, str, str]:
    """(生キー, ハッシュ, 表示用prefix) を返す。生キーはこの場でしか分からない"""
    raw_key = "usk_" + secrets.token_urlsafe(32)
    return raw_key, hash_api_key(raw_key), raw_key[:10]


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def _lookup_api_key(session: AsyncSession, raw_key: str) -> ApiKey | None:
    key_hash = hash_api_key(raw_key)
    result = await session.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    api_key = result.scalars().first()
    if api_key is None or api_key.revoked_at is not None:
        return None
    api_key.last_used_at = _now()
    await session.commit()
    return api_key


async def get_current_allowed_user_optional(request: Request, session: AsyncSession) -> AllowedUser | None:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        return None
    return await _lookup_session(session, session_id)


async def require_auth(request: Request, session: AsyncSession = Depends(get_db)) -> AllowedUser | None:
    """セッションCookie、または `Authorization: Bearer <APIキー>` のどちらかを要求する。
    APIキー経由のときは特定のユーザーの代理ではないためNoneを返す(呼び出し元が
    「機械アクセス」として扱ってよい)。ルーター単位で `dependencies=[Depends(require_auth)]`
    として使うのが基本形。settings.auth_enabledがFalse、またはsettings.demo_modeが
    Trueなら常に素通りする
    """
    if settings.demo_mode or not settings.auth_enabled:
        return None

    allowed_user = await get_current_allowed_user_optional(request, session)
    if allowed_user is not None:
        return allowed_user

    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        raw_key = auth_header[7:].strip()
        api_key = await _lookup_api_key(session, raw_key)
        if api_key is not None:
            return None

    raise HTTPException(status_code=401, detail="ログインが必要です")


async def allowed_users_is_empty(session: AsyncSession) -> bool:
    """allowed_usersが1件も無いか(=まだ誰も管理者として登録されていない、
    鶏と卵問題の状態)。起動時のseed_initial_adminと、ログインコールバックの
    自動管理者登録(routers/auth.py)の両方から使う共通判定。"""
    result = await session.execute(select(AllowedUser.id).limit(1))
    return result.scalars().first() is None


TOKEN_ENCRYPTION_KEY_SETTING = "system.token_encryption_key"


async def ensure_token_encryption_key(session: AsyncSession) -> str:
    """BASEトークン暗号化キーを決定する。.envのTOKEN_ENCRYPTION_KEYが設定されて
    いればそれを使う。未設定なら、AppSetting(このデータベースに永続化される
    設定値。resetの対象外)に保存済みの鍵を使い、無ければこの場で生成して
    保存する(初回起動時の1回だけ)。SESSION_SECRET_KEYと違い、この鍵は
    既に暗号化保存済みのトークンの復号に使うため、起動のたびに変えると
    過去のトークンが復号できなくなる。DBに永続化することで再起動しても
    同じ鍵を使い続けられる
    """
    if settings.token_encryption_key:
        return settings.token_encryption_key
    service = AppSettingService(session)
    existing = await service.get_value(TOKEN_ENCRYPTION_KEY_SETTING, "")
    if existing:
        return existing
    new_key = Fernet.generate_key().decode()
    await service.set(TOKEN_ENCRYPTION_KEY_SETTING, new_key)
    return new_key


async def seed_initial_admin(session: AsyncSession) -> None:
    """settings.initial_admin_identifierが設定されていて、allowed_usersが
    まだ空(初回起動)ならその識別子を管理者として登録する。鶏と卵問題の解決策。

    .envを事前設定しない運用では、代わりにログインコールバック側の
    自動管理者登録(allowed_users_is_empty参照)が同じ役割を果たす。
    """
    if not settings.initial_admin_identifier:
        return
    if not await allowed_users_is_empty(session):
        return
    session.add(AllowedUser(identifier=settings.initial_admin_identifier, label="初期管理者", is_admin=True))
    await session.commit()


_LOCAL_MODE_USER = AllowedUser(id=0, identifier="local", label="ローカルモード(認証なし)", is_admin=True)
# auth_enabled=Falseとは別の専用ユーザー。デモモードはauth_enabledを一切書き換えず
# 独立したフラグで動くため、区別できるようラベルを分けている(ログ等で見分ける用途)。
# 実在のアカウントのように見せるため、demo_seed_serviceの注文デモデータと同じ
# 「デモ 太郎」ペルソナの名前・ダミーメールアドレスを表示する
_DEMO_MODE_USER = AllowedUser(id=0, identifier="demo@unistock.example", label="デモ 太郎", is_admin=True)


async def require_admin(request: Request, session: AsyncSession = Depends(get_db)) -> AllowedUser:
    """管理者(許可ユーザー・APIキーの管理など)専用。APIキーでは通過できない。
    settings.auth_enabledがFalse、またはsettings.demo_modeがTrueなら常に管理者として素通りする"""
    if settings.demo_mode:
        return _DEMO_MODE_USER
    if not settings.auth_enabled:
        return _LOCAL_MODE_USER

    allowed_user = await get_current_allowed_user_optional(request, session)
    if allowed_user is None:
        raise HTTPException(status_code=401, detail="ログインが必要です")
    if not allowed_user.is_admin:
        raise HTTPException(status_code=403, detail="管理者権限が必要です")
    return allowed_user
