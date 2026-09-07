from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BomProductSetting(Base):
    """ショップの商品(shop_id, item_id)単位のBOM付随設定。bom_itemsは商品×部品の行の
    集まりで商品自体を表す行を持たないため、「PDF出力時にオプションを横並びの表に
    するか」のような商品1件に対する設定はこの別テーブルで持つ。行が無い商品は
    matrix_layout=false扱い。item_idはショップを跨いで衝突しうるため、shop_idとの
    複合主キーで一意性を保証する。
    """

    __tablename__ = "bom_product_settings"

    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    matrix_layout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Part.reorder_thresholdと同じ「未設定=アラート対象外」パターン。作成可能数(BOM一覧の
    # 「作成可能数」と同じ計算)がこの値を下回ったら通知する
    buildable_alert_threshold: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
