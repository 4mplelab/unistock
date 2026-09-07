import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ScheduleStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StockSchedule(Base):
    __tablename__ = "stock_schedules"
    __table_args__ = (CheckConstraint("target_stock >= 0", name="ck_stock_schedules_target_stock"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), nullable=False)
    platform: Mapped[str] = mapped_column(String(20), nullable=False, default="base")
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    item_name: Mapped[str | None] = mapped_column(String(255))
    target_stock: Mapped[int] = mapped_column(Integer, nullable=False)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ScheduleStatus.PENDING.value)
    result_message: Mapped[str | None] = mapped_column(Text)
    http_status: Mapped[int | None] = mapped_column(Integer)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
