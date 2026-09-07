from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Shop(Base):
    """接続しているショップ(ECアカウント)1件。プラットフォームの種類(platform)とは別軸で、
    同じプラットフォームでも複数ショップを区別するための単位。
    ec_oauth_tokens/orders/stock_schedules/bom_items/bom_product_settingsは
    すべてこのidをshop_idとして参照する。
    """

    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
