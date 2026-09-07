from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ManualItemVariationCreate(BaseModel):
    name: str
    # このバリエーション自体の価格(円)。未入力なら商品本体の価格を使う
    price: int | None = None
    stock: int = 0
    sort_order: int = 0


class ManualItemVariationUpsert(BaseModel):
    # 既存バリエーションのID。省略時は新規作成として扱う。既存のIDのうち、
    # 送られてこなかったものは削除される(商品の基本情報とまとめて1回で全置換する)
    id: int | None = None
    name: str
    price: int | None = None
    stock: int = 0
    sort_order: int = 0


class ManualItemVariationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: int | None
    stock: int
    sort_order: int


class ManualItemCreate(BaseModel):
    item_id: str
    title: str
    price: int | None = None
    stock: int = 0
    description: str | None = None
    variations: list[ManualItemVariationCreate] = []


class ManualItemUpdate(BaseModel):
    title: str | None = None
    price: int | None = None
    stock: int | None = None
    description: str | None = None
    # Noneなら未指定(バリエーションには触れない)。リストが渡されたら、それで全置換する
    variations: list[ManualItemVariationUpsert] | None = None


class ManualItemConsumeCreate(BaseModel):
    quantity: int = Field(gt=0)
    # 未指定なら商品本体の在庫を、指定すればそのバリエーションの在庫を減らす
    variation_id: int | None = None
    note: str | None = None


class ManualItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    shop_id: int
    item_id: str
    title: str
    price: int | None
    stock: int
    description: str | None
    created_at: datetime
    variations: list[ManualItemVariationRead] = []
