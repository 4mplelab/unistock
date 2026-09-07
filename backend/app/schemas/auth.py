from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CurrentUserRead(BaseModel):
    identifier: str
    label: str | None
    avatar_url: str | None = None
    is_admin: bool
    provider: str
    # false: サーバー側でAUTH_ENABLED=falseになっており、ログイン・ログアウトの概念が
    # そもそも存在しない(常にこのユーザーとして扱われる)
    auth_enabled: bool = True


class AllowedUserCreate(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    label: str | None = Field(default=None, max_length=255)
    is_admin: bool = Field(default=False)


class AllowedUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    identifier: str
    label: str | None
    avatar_url: str | None
    is_admin: bool
    created_at: datetime


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ApiKeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiKeyCreateResult(BaseModel):
    key: ApiKeyRead
    # 生キーはこのレスポンスでのみ返す。二度と表示されない
    raw_key: str
