from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, computed_field

TagStr = Annotated[str, Field(min_length=1, max_length=20)]


class PartCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=100)
    stock: int = Field(default=0, ge=0)
    unit_cost: int | None = Field(default=None, ge=0)
    tags: list[TagStr] | None = Field(default=None, max_length=5)
    group: str | None = Field(default=None, max_length=100)
    colors: list[str] | None = Field(default=None)
    purchase_url: str | None = Field(default=None, max_length=2000)
    reorder_threshold: int | None = Field(default=None, ge=0)
    purchasable: bool = Field(default=True)
    memo: str | None = Field(default=None)


class PartUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=100)
    stock: int | None = Field(default=None, ge=0)
    unit_cost: int | None = Field(default=None, ge=0)
    tags: list[TagStr] | None = Field(default=None, max_length=5)
    group: str | None = Field(default=None, max_length=100)
    colors: list[str] | None = Field(default=None)
    purchase_url: str | None = Field(default=None, max_length=2000)
    reorder_threshold: int | None = Field(default=None, ge=0)
    purchasable: bool | None = Field(default=None)
    memo: str | None = Field(default=None)
    # 在庫数を直接変更した場合、在庫変動履歴(reason=manual_edit)に記録するメモ(任意)
    note: str | None = Field(default=None, max_length=255)


class PartAddStock(BaseModel):
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)


class PartRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sku: str | None
    stock: int
    reserved: int
    unit_cost: int | None
    tags: list[str] | None
    group: str | None
    colors: list[str] | None
    purchase_url: str | None
    reorder_threshold: int | None
    purchasable: bool
    memo: str | None
    created_at: datetime
    updated_at: datetime
    # 発注中(status=ordered)の発注数量の合計。一覧・編集画面で「発注中」表示に使う
    ordered_quantity: int = 0

    @computed_field
    @property
    def available(self) -> int:
        return self.stock - self.reserved


class PartImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]
