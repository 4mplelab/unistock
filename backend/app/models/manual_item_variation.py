from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ManualItemVariation(Base):
    """手動ショップ商品(ManualItem)が持つ単一軸のバリエーション(例: 色・サイズ)。
    BASEの単一属性バリエーション(ItemVariation)に相当し、BOM側の条件マッチング
    (selector_type='variation')にそのまま乗せられるよう同じ形(name/price/stock)にする。
    グループを組み合わせる「オプション」機構は対象外(BOOTH等、単一軸のみの外部サイトを
    想定しているため)。

    priceはこのバリエーション自体の価格(本体価格への加算ではなく、選ばれた時点でこの
    金額そのものを使う)。BOOTHのバリエーション機能が「本体価格+差額」ではなく
    バリエーションごとに独立した価格を持つ方式であるため、それに合わせている。
    """

    __tablename__ = "manual_item_variations"
    __table_args__ = (
        ForeignKeyConstraint(["shop_id", "item_id"], ["manual_items.shop_id", "manual_items.item_id"]),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(Integer, nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # このバリエーション自体の価格(円)。未入力ならNoneで、注文登録時は商品本体の価格を使う
    price: Mapped[int | None] = mapped_column(Integer)
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    item: Mapped["ManualItem"] = relationship(back_populates="variations")
