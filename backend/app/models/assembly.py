from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Assembly(Base):
    """中間品(半製品)。部品と同様に在庫数を持ち、組立操作で在庫が増減する。"""

    __tablename__ = "assemblies"
    __table_args__ = (
        # stockはマイナスを許容する(Part参照。BASE発送確定=実際には在庫があった事実であり、
        # UniStock側のカウントが実態とズレていただけなので、発送時の在庫消費をブロックしない)
        CheckConstraint("reserved >= 0", name="ck_assemblies_reserved"),
        CheckConstraint("unit_cost IS NULL OR unit_cost >= 0", name="ck_assemblies_unit_cost"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100))
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 中間品自体の原価ではなく、組成(レシピ)の部品原価合計だけでは表せない追加費用
    # (組み立て工賃・外注費など)。中間品の実際の原価は、この値+レシピの原価合計で
    # 計算する(assembly_service.compute_assembly_costs参照)
    unit_cost: Mapped[int | None] = mapped_column(Integer)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(50)))
    # タグ(複数・自由入力)とは別に、一覧の絞り込み・並び替え用の単一の分類(Part.group参照)
    group: Mapped[str | None] = mapped_column(String(100))
    memo: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
