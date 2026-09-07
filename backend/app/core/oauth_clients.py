from authlib.integrations.starlette_client import OAuth

from app.config import settings

# ログインに使えるプロバイダの一覧(表示順もこの順)。
# Google/Microsoftは標準のOIDC。GitHub/Xは素のOAuth2で、id_tokenが無いため
# 認可後に別途プロフィールAPIを叩いてメール/ユーザーIDを取得する(routers/auth.py参照)
PROVIDERS = ["google", "microsoft", "github", "x"]

oauth = OAuth()

oauth.register(
    name="google",
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    client_kwargs={"scope": "openid email profile"},
)

oauth.register(
    name="microsoft",
    server_metadata_url="https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    client_id=settings.microsoft_client_id,
    client_secret=settings.microsoft_client_secret,
    client_kwargs={"scope": "openid email profile"},
)

oauth.register(
    name="github",
    access_token_url="https://github.com/login/oauth/access_token",
    authorize_url="https://github.com/login/oauth/authorize",
    api_base_url="https://api.github.com/",
    client_id=settings.github_client_id,
    client_secret=settings.github_client_secret,
    client_kwargs={"scope": "read:user user:email"},
)

# X(旧Twitter)はメールアドレスを一切返さない仕様のため、identifierは
# "x:<user_id>" 形式のプレースホルダーで扱う(routers/auth.py参照)。
# OAuth2 + PKCE必須
oauth.register(
    name="x",
    access_token_url="https://api.twitter.com/2/oauth2/token",
    authorize_url="https://twitter.com/i/oauth2/authorize",
    api_base_url="https://api.twitter.com/2/",
    client_id=settings.x_client_id,
    client_secret=settings.x_client_secret,
    client_kwargs={"scope": "tweet.read users.read", "code_challenge_method": "S256"},
)
