from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EventLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    level: str
    message: str
    order_id: int | None
    order_unique_key: str | None = None
    item_id: str | None
    shop_id: int | None
    created_at: datetime
    occurrence_count: int
    last_occurred_at: datetime


class EventLogListRead(BaseModel):
    items: list[EventLogRead]
    total: int
    # highlight指定時、そのイベントログが含まれるページ番号(1始まり)。フロントエンドが
    # 自分でページを計算しなくても該当ページへ自動的に合わせられるようにする
    page: int = 1
