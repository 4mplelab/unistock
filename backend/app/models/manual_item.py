from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ManualItem(Base):
    """外部連携APIを持たないショップ(ECPlatform.MANUAL)の商品マスタ。BASEショップでは
    商品の実体(タイトル・在庫・価格)を都度BASEからライブ取得するため永続化しないが、
    手動ショップには問い合わせ先が無いためこのテーブルが在庫・価格の一次情報になる。
    item_idはBASEのような外部採番が無いため、ユーザーが手入力する一意コード。
    """

    __tablename__ = "manual_items"

    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    price: Mapped[int | None] = mapped_column(Integer)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    variations: Mapped[list["ManualItemVariation"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="ManualItemVariation.sort_order, ManualItemVariation.id",
        lazy="selectin",
    )
