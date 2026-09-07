import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.oauth_clients import PROVIDERS, oauth
from app.database import get_db
from app.models.auth import AllowedUser, LoginSession
from app.schemas.auth import CurrentUserRead
from app.services.auth_service import (
    SESSION_COOKIE_NAME,
    allowed_users_is_empty,
    create_session,
    delete_session,
    get_current_allowed_user_optional,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/providers", response_model=list[str])
async def list_configured_providers() -> list[str]:
    """クライアントID/シークレットが設定済みのプロバイダのみ返す(未ログインの
    ログイン画面から呼ぶため認証不要)。フロントエンドはこれを見てボタンを出し分ける"""
    return [
        p
        for p in PROVIDERS
        if getattr(settings, f"{p}_client_id") and getattr(settings, f"{p}_client_secret")
    ]


async def _fetch_identity(provider: str, token: dict, client) -> tuple[str, str | None, str | None]:
    """(identifier, 表示名, プロフィール画像URL) を返す。Google/MicrosoftはOIDCの
    id_tokenから、GitHubは別途プロフィールAPIから、Xはメールを取得できないため
    ユーザーIDを使う。
    """
    if provider in ("google", "microsoft"):
        userinfo = token.get("userinfo")
        if userinfo is None:
            userinfo = await client.parse_id_token(token)
        email = userinfo.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="メールアドレスを取得できませんでした")
        # Microsoftのuserinfoは仕様上pictureクレームを返さないため、その場合はNoneのまま
        return email, userinfo.get("name"), userinfo.get("picture")

    if provider == "github":
        resp = await client.get("user", token=token)
        profile = resp.json()
        email = profile.get("email")
        if not email:
            emails_resp = await client.get("user/emails", token=token)
            emails = emails_resp.json()
            primary = next((e["email"] for e in emails if e.get("primary") and e.get("verified")), None)
            email = primary or next((e["email"] for e in emails if e.get("verified")), None)
        if not email:
            raise HTTPException(
                status_code=400,
                detail="検証済みメールアドレスを取得できませんでした(GitHubの設定でメールを検証済みにしてください)",
            )
        return email, profile.get("name") or profile.get("login"), profile.get("avatar_url")

    if provider == "x":
        resp = await client.get("users/me", token=token, params={"user.fields": "profile_image_url"})
        profile = resp.json().get("data", {})
        user_id = profile.get("id")
        if not user_id:
            raise HTTPException(status_code=400, detail="Xのユーザー情報を取得できませんでした")
        return f"x:{user_id}", profile.get("name") or profile.get("username"), profile.get("profile_image_url")

    raise HTTPException(status_code=400, detail=f"未対応のプロバイダです: {provider}")


@router.get("/{provider}/login")
async def login(provider: str, request: Request):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="未対応のプロバイダです")
    client = oauth.create_client(provider)
    redirect_uri = f"{settings.backend_base_url}/api/auth/{provider}/callback"
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/{provider}/callback")
async def callback(provider: str, request: Request, session: AsyncSession = Depends(get_db)):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="未対応のプロバイダです")
    client = oauth.create_client(provider)
    try:
        token = await client.authorize_access_token(request)
    except Exception:
        logger.exception("OAuthログインに失敗しました(provider=%s)", provider)
        return RedirectResponse(f"{settings.frontend_base_url}/login?error=oauth_failed")

    try:
        identifier, display_name, avatar_url = await _fetch_identity(provider, token, client)
    except HTTPException as e:
        logger.warning("プロフィール取得に失敗しました(provider=%s): %s", provider, e.detail)
        return RedirectResponse(f"{settings.frontend_base_url}/login?error=profile_failed")

    result = await session.execute(select(AllowedUser).where(AllowedUser.identifier == identifier))
    allowed_user = result.scalars().first()
    if allowed_user is None:
        # allowed_usersが1件も無い(初回起動)場合に限り、今ログインに成功した
        # このアカウントをそのまま最初の管理者として登録する(鶏と卵問題の解決策。
        # .envのinitial_admin_identifierを使うseed_initial_adminの対話版)。
        # 1人でも既に登録されていれば通常通り拒否する
        if not await allowed_users_is_empty(session):
            return RedirectResponse(f"{settings.frontend_base_url}/login?error=not_allowed")
        allowed_user = AllowedUser(identifier=identifier, label=display_name, avatar_url=avatar_url, is_admin=True)
        session.add(allowed_user)
        await session.flush()

    # ログイン成功のたびにプロバイダ側の表示名・アイコンで最新化する
    # (初回管理者の自動登録時に付与した仮の表示名もここで実名に置き換わる)
    if display_name:
        allowed_user.label = display_name
    allowed_user.avatar_url = avatar_url

    session_id = await create_session(session, allowed_user.id, provider)

    redirect = RedirectResponse(f"{settings.frontend_base_url}/")
    redirect.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        secure=settings.backend_base_url.startswith("https://"),
        samesite="lax",
        max_age=settings.session_ttl_days * 24 * 3600,
    )
    return redirect


@router.post("/logout")
async def logout(request: Request, response: Response, session: AsyncSession = Depends(get_db)) -> dict:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        await delete_session(session, session_id)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"ok": True}


@router.get("/me", response_model=CurrentUserRead)
async def me(request: Request, session: AsyncSession = Depends(get_db)) -> CurrentUserRead:
    # このエンドポイントはrequire_auth/require_adminを経由しない独自ガードのため、
    # demo_modeのバイパスもここに個別で必要(auth_service.py側のバイパスとは別)。
    # auth_enabled=Trueにして、実在のアカウントのように名前・メールアドレス付きで
    # 表示されるようにする(ログアウトしても実際のセッションが無いため無害で、
    # /loginに戻ればデモ用ボタンからすぐ「再ログイン」できる)
    if settings.demo_mode:
        return CurrentUserRead(
            identifier="demo@unistock.example", label="デモ 太郎", is_admin=True, provider="demo", auth_enabled=True
        )
    if not settings.auth_enabled:
        return CurrentUserRead(
            identifier="local", label="ローカルモード(認証なし)", is_admin=True, provider="", auth_enabled=False
        )

    allowed_user = await get_current_allowed_user_optional(request, session)
    if allowed_user is None:
        raise HTTPException(status_code=401, detail="未ログインです")
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    login_session = await session.get(LoginSession, session_id) if session_id else None
    return CurrentUserRead(
        identifier=allowed_user.identifier,
        label=allowed_user.label,
        avatar_url=allowed_user.avatar_url,
        is_admin=allowed_user.is_admin,
        provider=login_session.provider if login_session else "",
        auth_enabled=True,
    )
