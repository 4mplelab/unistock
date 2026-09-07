from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

StockMovementReasonLiteral = Literal[
    "manual_edit",
    "add_stock",
    "purchase_order_received",
    "purchase_order_receive_undone",
    "order_consumed",
    "order_dispatch_undone",
    "assembly_build",
    "assembly_build_material",
    "manual_item_consumed",
]

ComponentTypeLiteral = Literal["part", "assembly"]


class StockMovementRead(BaseModel):
    id: int
    component_type: ComponentTypeLiteral
    component_id: int
    component_name: str
    quantity: int
    reason: StockMovementReasonLiteral
    note: str | None
    order_id: int | None
    order_unique_key: str | None = None
    purchase_order_id: int | None
    shop_id: int | None
    created_at: datetime


class StockMovementListRead(BaseModel):
    items: list[StockMovementRead]
    total: int


class ConsumptionSummaryPoint(BaseModel):
    date: date
    quantity: int


class ConsumptionSummarySeries(BaseModel):
    component_type: ComponentTypeLiteral
    component_id: int
    component_name: str
    total: int
    points: list[ConsumptionSummaryPoint]


class ConsumptionSummaryRead(BaseModel):
    days: int
    series: list[ConsumptionSummarySeries]


class AssemblyBuildSummaryPoint(BaseModel):
    date: date
    quantity: int


class AssemblyBuildSummaryRead(BaseModel):
    days: int
    points: list[AssemblyBuildSummaryPoint]
