from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AssemblyItem(Base):
    """中間品(Assembly)のレシピ行。材料は部品(material_part_id)または
    別の中間品(material_assembly_id)のどちらか一方。
    """

    __tablename__ = "assembly_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_assembly_items_quantity"),
        CheckConstraint(
            "(material_part_id IS NULL) != (material_assembly_id IS NULL)",
            name="ck_assembly_items_exactly_one_material",
        ),
        CheckConstraint(
            "material_assembly_id IS NULL OR material_assembly_id != assembly_id",
            name="ck_assembly_items_no_self_reference",
        ),
        Index(
            "ix_assembly_items_unique_part",
            "assembly_id",
            "material_part_id",
            unique=True,
            postgresql_where="material_part_id IS NOT NULL",
        ),
        Index(
            "ix_assembly_items_unique_assembly",
            "assembly_id",
            "material_assembly_id",
            unique=True,
            postgresql_where="material_assembly_id IS NOT NULL",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id"), nullable=False)
    material_part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"))
    material_assembly_id: Mapped[int | None] = mapped_column(ForeignKey("assemblies.id"))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
