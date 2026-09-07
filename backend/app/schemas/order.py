from datetime import datetime

from pydantic import BaseModel, ConfigDict


class OrderItemOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    option_name: str | None
    option_value: str | None


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: str
    title: str | None
    quantity: int
    price: int | None
    variation: str | None
    # BASEの注文明細行のstatus("ordered"/"cancelled"等)。商品単位でBASE側だけキャンセル
    # されることがある(注文全体のdispatch_statusとは独立)
    status: str
    picked: bool
    options: list[OrderItemOptionRead] = []


class OrderItemPickedUpdate(BaseModel):
    picked: bool


class OrderDispatchStatusUpdate(BaseModel):
    # 手動ショップ(API連携なし)の注文のみ許可。"dispatched" または "cancelled"
    dispatch_status: str


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    platform: str
    unique_key: str
    dispatch_status: str
    ordered_at: datetime
    dispatched_at: datetime | None
    cancelled_at: datetime | None
    modified_at: datetime | None
    # 注文合計金額(Order.totalの別名。OrderListRead.total(件数)と紛らわしいため
    # スキーマ上はtotal_amountという名前にしている)。取得できていない古い注文はNone
    total_amount: int | None
    last_name: str | None
    first_name: str | None
    prefecture: str | None
    address: str | None
    email: str | None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemRead] = []


class OrderListRead(BaseModel):
    items: list[OrderRead]
    total: int
    page: int


class IngestionResultRead(BaseModel):
    orders_seen: int
    new_orders: int
    transitioned_orders: int
    errors: list[str]
