from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StockScheduleCreate(BaseModel):
    shop_id: int
    item_id: str = Field(min_length=1, max_length=64)
    item_name: str | None = Field(default=None, max_length=255)
    target_stock: int = Field(ge=0)
    run_at: datetime


class StockScheduleUpdate(BaseModel):
    target_stock: int = Field(ge=0)
    run_at: datetime


class StockScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    platform: str
    item_id: str
    item_name: str | None
    target_stock: int
    run_at: datetime
    status: str
    result_message: str | None
    http_status: int | None
    executed_at: datetime | None
    created_at: datetime


class StockScheduleListRead(BaseModel):
    items: list[StockScheduleRead]
    total: int
