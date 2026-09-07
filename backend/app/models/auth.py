from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AllowedUser(Base):
    """UniStockへのログインを許可するユーザーの一覧。

    identifierはGoogle/Microsoft/GitHubではメールアドレス、Xはメールアドレスを
    取得できないため "x:<user_id>" 形式の識別子を使う(provider列と併せて一意に
    ログイン試行のidentifierと突き合わせる)。
    """

    __tablename__ = "allowed_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    identifier: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    label: Mapped[str | None] = mapped_column(String(255))
    # プロバイダのプロフィール画像URL。ログイン成功のたびに最新のものへ更新する
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LoginSession(Base):
    """ログインセッション。idをそのままセッションCookieの値として使う
    (十分なエントロピーを持つランダム文字列のため、別途署名は行わない)。"""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    allowed_user_id: Mapped[int] = mapped_column(ForeignKey("allowed_users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApiKey(Base):
    """外部システムからのサーバー間通信用APIキー。
    生の値はレスポンスで一度だけ返し、以降はSHA-256ハッシュだけを保持する
    (key_prefixは管理画面で「どのキーか」を判別するための表示用)。
    """

    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
