from datetime import datetime

from pydantic import BaseModel


class ReservingOrderRead(BaseModel):
    order_id: int
    unique_key: str
    dispatch_status: str
    ordered_at: datetime
    quantity: int
