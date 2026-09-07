from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class BomItem(Base):
    """商品(item_id)の構成。部品(part_id)・中間品(assembly_id)・部品不要(どちらもNULL)のいずれか。

    この行がいつ消費されるかは`conditions`(BomItemCondition、0..N件)で決まる。
    条件が0件の行は「共通行」(常に消費する)。条件が1件以上ある行は、その**全て**の
    条件(AND)を注文の選択内容が満たしたときだけ追加で消費する。
    1条件だけならBASEの単一オプション/バリエーション選択に対応する行になり、
    複数条件を持たせれば「右モジュール=Xかつケース=Yのときだけこの部品」のような
    組み合わせ条件も表現できる(2026-08-26、トラックボールユニット等の実例を踏まえ一般化)。

    component_type='none'(part_id/assembly_idどちらもNULL)は「この条件では意図的に
    部品を消費しない」ことを明示するマーカー行(例: はんだ付けオプションの「なし」)。
    行が1つも無い「未設定」状態と区別するために存在する(2026-08-26追加)。
    """

    __tablename__ = "bom_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_bom_items_quantity"),
        CheckConstraint(
            "(component_type = 'none' AND part_id IS NULL AND assembly_id IS NULL)"
            " OR (component_type = 'part' AND part_id IS NOT NULL AND assembly_id IS NULL)"
            " OR (component_type = 'assembly' AND assembly_id IS NOT NULL AND part_id IS NULL)",
            name="ck_bom_items_component_consistency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    item_name: Mapped[str | None] = mapped_column(String(255))
    component_type: Mapped[str] = mapped_column(String(20), nullable=False, default="part")
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"))
    assembly_id: Mapped[int | None] = mapped_column(ForeignKey("assemblies.id"))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    conditions: Mapped[list["BomItemCondition"]] = relationship(
        back_populates="bom_item", cascade="all, delete-orphan", lazy="selectin"
    )


class BomItemCondition(Base):
    """BomItem行が消費される条件の1つ。1行が複数件持てる(AND条件)。

    selector_type='option'ならBASEの名前付きオプション選択肢
    (selector_id=option_variation_id)、'variation'ならBASEの単一属性の種類
    (selector_id=variation_id)を指す。group_name/choice_nameは表示用のスナップショット、
    group_order/choice_orderはBASE上の表示順(登録時に取得したlist_order由来のindex、
    CSV等取得できない経路ではNULL)。
    """

    __tablename__ = "bom_item_conditions"
    __table_args__ = (
        CheckConstraint("selector_type IN ('option', 'variation')", name="ck_bom_item_conditions_selector_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    bom_item_id: Mapped[int] = mapped_column(ForeignKey("bom_items.id", ondelete="CASCADE"), nullable=False)
    selector_type: Mapped[str] = mapped_column(String(20), nullable=False)
    selector_id: Mapped[str] = mapped_column(String(64), nullable=False)
    group_name: Mapped[str | None] = mapped_column(String(255))
    choice_name: Mapped[str | None] = mapped_column(String(255))
    group_order: Mapped[int | None] = mapped_column(Integer)
    choice_order: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bom_item: Mapped["BomItem"] = relationship(back_populates="conditions")
