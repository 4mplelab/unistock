from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ShopRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    platform: str
    name: str
    is_active: bool
    created_at: datetime


class ShopCreate(BaseModel):
    platform: str
    name: str


class ShopUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    # 現状はbase→manual(手動管理化)のみ許可。それ以外の遷移はShopServiceで拒否する
    platform: str | None = None
