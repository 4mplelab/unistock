from datetime import date, datetime

from pydantic import BaseModel, Field


class PurchaseOrderCreate(BaseModel):
    part_id: int
    shop_id: int
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)
    expected_delivery_date: date | None = Field(default=None)
    order_url: str | None = Field(default=None, max_length=2048)


class PurchaseOrderUrlUpdate(BaseModel):
    order_url: str | None = Field(default=None, max_length=2048)


class PurchaseOrderReceiveInput(BaseModel):
    # 未指定なら現在時刻を使う
    received_at: datetime | None = Field(default=None)


class PurchaseOrderRead(BaseModel):
    id: int
    part_id: int
    part_name: str
    shop_id: int
    quantity: int
    status: str
    ordered_at: datetime
    received_at: datetime | None
    expected_delivery_date: date | None
    note: str | None
    order_url: str | None
    created_at: datetime


class PurchaseOrderListRead(BaseModel):
    items: list[PurchaseOrderRead]
    total: int
    # highlight指定時、その発注が含まれるページ番号(1始まり)。フロントエンドが
    # 自分でページを計算しなくても該当ページへ自動的に合わせられるようにする
    page: int = 1


class LeadTimeSummaryRead(BaseModel):
    # status=receivedの発注について、発注日(ordered_at)から入荷日(received_at)までの
    # 経過日数(四捨五入)を実績値として並べたもの。件数が少ない運用規模を想定し、
    # ヒストグラムのビン分けはバックエンドでは行わずフロントエンドに任せる
    lead_times_days: list[int]


class ReorderNeededRead(BaseModel):
    id: int
    name: str
    sku: str | None
    stock: int
    reserved: int
    available: int
    reorder_threshold: int
    purchase_url: str | None
    has_open_order: bool
