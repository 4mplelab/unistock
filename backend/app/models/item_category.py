from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ItemCategory(Base):
    """商品(shop_id, item_id)が属するカテゴリ1件。1商品が複数カテゴリに属する場合は
    複数行になる。item_category_sync_schedulerが定期的にBASE APIから取得し、
    ショップ単位で全件洗い替えする(カテゴリから外れた組み合わせも正しく消えるように)。
    """

    __tablename__ = "item_categories"

    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    category_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_name: Mapped[str] = mapped_column(String(200), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
