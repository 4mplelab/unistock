import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class StockMovementReason(str, enum.Enum):
    MANUAL_EDIT = "manual_edit"
    ADD_STOCK = "add_stock"
    PURCHASE_ORDER_RECEIVED = "purchase_order_received"
    PURCHASE_ORDER_RECEIVE_UNDONE = "purchase_order_receive_undone"
    ORDER_CONSUMED = "order_consumed"
    ORDER_DISPATCH_UNDONE = "order_dispatch_undone"
    ASSEMBLY_BUILD = "assembly_build"
    ASSEMBLY_BUILD_MATERIAL = "assembly_build_material"
    MANUAL_ITEM_CONSUMED = "manual_item_consumed"


class StockMovement(Base):
    """部品/中間品の在庫数変動履歴。

    従来のAssemblyBuild(中間品限定・組立と手動修正のみ記録)を発展させ、部品・中間品
    共通で、注文発送による自動消費(order_consumed)や発注入荷(purchase_order_received)、
    組立時に消費された材料側(assembly_build_material)まで含めて記録する。
    quantityは符号付きの差分(増加は正、減少は負)。part_id/assembly_idのどちらか一方を持つ。
    """

    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint(
            "(part_id IS NULL) != (assembly_id IS NULL)",
            name="ck_stock_movements_exactly_one_component",
        ),
        CheckConstraint("quantity != 0", name="ck_stock_movements_quantity_nonzero"),
        CheckConstraint(
            "reason IN ('manual_edit', 'add_stock', 'purchase_order_received', "
            "'purchase_order_receive_undone', 'order_consumed', 'order_dispatch_undone', "
            "'assembly_build', 'assembly_build_material', 'manual_item_consumed')",
            name="ck_stock_movements_reason",
        ),
        Index("ix_stock_movements_part", "part_id"),
        Index("ix_stock_movements_assembly", "assembly_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"))
    assembly_id: Mapped[int | None] = mapped_column(ForeignKey("assemblies.id"))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    purchase_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="SET NULL")
    )
    # 注文経由(order_id)/発注経由(purchase_order_id)の消費・入荷ならそのショップのid、
    # 手動調整・組立操作など共有在庫そのものへの操作ならNone(真に共通の行)。
    # 一覧画面の「選択中ショップ+共通」絞り込みや関連リンクの制御に使う
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
