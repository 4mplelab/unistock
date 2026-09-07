import enum
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PurchaseOrderStatus(str, enum.Enum):
    ORDERED = "ordered"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_purchase_orders_quantity"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), nullable=False)
    # 部品自体は複数ショップで共有する在庫だが、「どの発注がどのショップの需要による
    # ものか」を明確に記録するため必須にする(将来のショップ別アクセス権限機能に向けて)。
    # 発注操作時はUIで選ばせず、ヘッダーで選択中のショップを自動的に使う
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=PurchaseOrderStatus.ORDERED.value)
    ordered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 任意入力。過ぎても自動で何かするわけではないが、ダッシュボード・発注管理での
    # 「納期超過」表示の基準に使う
    expected_delivery_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(255))
    # 実際に発注先(仕入れ先サイト等)で発注した後、その注文ページのURLを控えておくための
    # 参照用フィールド。発注(UniStock側の記録作成)とは別のタイミングで入力・更新される
    order_url: Mapped[str | None] = mapped_column(String(2048))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
