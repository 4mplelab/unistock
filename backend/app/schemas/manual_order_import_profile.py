from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ManualOrderCsvColumnMapping(BaseModel):
    """CSVの各列名(ヘッダー)を、UniStockの手動注文のどの項目として読むかの対応表。
    値はCSVのヘッダー名そのもの。未使用の項目はNone(item_idのみ必須)。
    """

    order_ref: str | None = None
    ordered_at: str | None = None
    last_name: str | None = None
    first_name: str | None = None
    prefecture: str | None = None
    address: str | None = None
    email: str | None = None
    item_id: str
    quantity: str | None = None
    variation_name: str | None = None
    price: str | None = None


class ManualOrderImportProfileCreate(BaseModel):
    name: str
    mapping: ManualOrderCsvColumnMapping


class ManualOrderImportProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    mapping: ManualOrderCsvColumnMapping
    created_at: datetime
