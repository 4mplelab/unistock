from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Part(Base):
    __tablename__ = "parts"
    __table_args__ = (
        # stockはマイナスを許容する。BASEで発送が確定した = 実際には在庫があったという
        # 事実(BASE側が真実)であり、UniStock側の在庫カウントが実態とズレていただけなので、
        # 発送時の在庫消費(_consume)をこの制約でブロックしてはならない。マイナスは
        # 「在庫数の記録が実態とズレている」ことを示すシグナルとして扱う
        CheckConstraint("reserved >= 0", name="ck_parts_reserved"),
        CheckConstraint("unit_cost IS NULL OR unit_cost >= 0", name="ck_parts_unit_cost"),
        CheckConstraint(
            "reorder_threshold IS NULL OR reorder_threshold >= 0", name="ck_parts_reorder_threshold"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100))
    stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 単価(円)。原価計算機能で使う想定。未入力はNone(0円との区別のため)
    unit_cost: Mapped[int | None] = mapped_column(Integer)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(50)))
    # タグ(複数・自由入力)とは別に、一覧の絞り込み・並び替え用の単一の分類
    group: Mapped[str | None] = mapped_column(String(100))
    # 部品の実物の色。複数選択可(例: ["ブラック", "ゴールド"]のようなデュアルカラー)
    colors: Mapped[list[str] | None] = mapped_column(ARRAY(String(50)))
    purchase_url: Mapped[str | None] = mapped_column(String(2000))
    # この数値をavailable(stock-reserved)が下回ったら発注が必要。未設定はアラート対象外
    reorder_threshold: Mapped[int | None] = mapped_column(Integer)
    # False = 外部発注せず自社で製造する部品(例: 3Dプリント品)。「発注する」ボタンや
    # 発注が必要な部品アラートの対象外にする(在庫追加ボタンでの直接補充のみ)
    purchasable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    memo: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
