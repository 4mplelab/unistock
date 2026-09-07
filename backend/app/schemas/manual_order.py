from datetime import datetime

from pydantic import BaseModel


class ManualOrderItemCreate(BaseModel):
    item_id: str
    quantity: int
    variation_id: int | None = None
    # 未指定なら商品マスタの価格(+バリエーションの追加価格)から自動算出する
    price: int | None = None


class ManualOrderCreate(BaseModel):
    ordered_at: datetime | None = None
    last_name: str | None = None
    first_name: str | None = None
    prefecture: str | None = None
    address: str | None = None
    email: str | None = None
    items: list[ManualOrderItemCreate]


class ManualOrderImportResult(BaseModel):
    created: int
    errors: list[str]


class ManualOrderCsvPreview(BaseModel):
    columns: list[str]
    sample_rows: list[dict[str, str]]
