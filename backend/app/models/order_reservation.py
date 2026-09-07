from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OrderPartReservation(Base):
    """注文が実際に引当てた部品・中間品の数量台帳。

    _reserve時点で「実際に引当てた量」をここに書き込み、_consume/_releaseは
    BOMを再参照せずこの台帳を見る。注文後にBOMが編集されても、その注文が
    引当てた実際の量とズレない設計。part_id/assembly_idのどちらか一方を持つ
    (部品/中間品どちらの引当も同じ台帳で記録する)。

    1つの注文の同じ部品/中間品に対して複数行が存在しうる(各行は1回の_reserve呼び出しで
    生成された「バッチ」を表す。当初は注文内で1商品1部品につき1行だったが、BOM未設定等で
    一部商品だけ引当が遅れて後から追加成立するケースに対応するため、行を都度追加する方式に
    変更した。2026-08-26)。`applied`は、この行に対応する在庫増減(_consume/_release)が
    完了したかどうかを表し、これによって同じ行を二重に消費/解放しないようにする。
    """

    __tablename__ = "order_part_reservations"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_part_reservations_quantity"),
        CheckConstraint(
            "(part_id IS NULL) != (assembly_id IS NULL)",
            name="ck_order_part_reservations_exactly_one_component",
        ),
        Index("ix_order_part_reservations_order_part", "order_id", "part_id"),
        Index("ix_order_part_reservations_order_assembly", "order_id", "assembly_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    # どの注文明細(商品)由来の引当かを記録する(注文サマリで商品ごとに内訳表示するため)。
    # 過去分(このカラム追加前)の行はNULLのまま残る
    order_item_id: Mapped[int | None] = mapped_column(ForeignKey("order_items.id"))
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"))
    assembly_id: Mapped[int | None] = mapped_column(ForeignKey("assemblies.id"))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
