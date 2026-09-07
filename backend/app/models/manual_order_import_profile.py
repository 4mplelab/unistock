from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ManualOrderImportProfile(Base):
    """手動注文CSVインポートの列マッピングを、ショップごとに名前を付けて保存したもの。

    各列は「CSVのどの列名(ヘッダー)をこのUniStockの項目として読むか」を保持する。
    未使用の項目はNULL(item_idのみ必須、残りは省略可)。
    """

    __tablename__ = "manual_order_import_profiles"
    __table_args__ = (
        UniqueConstraint("shop_id", "name", name="uq_manual_order_import_profiles_shop_id_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    order_ref_column: Mapped[str | None] = mapped_column(String(100))
    ordered_at_column: Mapped[str | None] = mapped_column(String(100))
    last_name_column: Mapped[str | None] = mapped_column(String(100))
    first_name_column: Mapped[str | None] = mapped_column(String(100))
    prefecture_column: Mapped[str | None] = mapped_column(String(100))
    address_column: Mapped[str | None] = mapped_column(String(100))
    email_column: Mapped[str | None] = mapped_column(String(100))
    item_id_column: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity_column: Mapped[str | None] = mapped_column(String(100))
    variation_name_column: Mapped[str | None] = mapped_column(String(100))
    price_column: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
