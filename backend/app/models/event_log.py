import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EventLogLevel(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class EventLogCategory(str, enum.Enum):
    RESERVATION_SKIPPED = "reservation_skipped"
    ASSEMBLY_STOCK_SHORTFALL = "assembly_stock_shortfall"
    STOCK_OPERATION_FAILED = "stock_operation_failed"
    RETENTION_CLEANUP = "retention_cleanup"
    AUTH_ERROR = "auth_error"


class EventLog(Base):
    """ユーザーが見て判断・対応すべき「業務イベント」の記録。

    技術的な詳細(スタックトレース等)はファイルログ(logging_config.py参照)に任せ、
    ここには「BOM未設定でスキップした」「自動削除でN件消した」等、業務上意味のある
    要約だけを記録する。件数が少ないためDBに保存しても負荷は問題にならず、
    フロント表示・保持期間による自動削除(RetentionService)の対象にできる。
    """

    __tablename__ = "event_logs"
    __table_args__ = (
        CheckConstraint(
            "category IN ('reservation_skipped', 'assembly_stock_shortfall', 'stock_operation_failed', "
            "'retention_cleanup', 'auth_error')",
            name="ck_event_logs_category",
        ),
        CheckConstraint("level IN ('info', 'warning', 'error')", name="ck_event_logs_level"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default=EventLogLevel.INFO.value)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    # BASEの商品ID。BOM編集画面(/bom/{shop_id}/{item_id}/edit)へのリンクに使う
    item_id: Mapped[str | None] = mapped_column(String(64))
    # order_id経由でショップが分かる行はそのショップのid、retention_cleanup等の
    # 真に共通のイベントはNone。一覧画面の「選択中ショップ+共通」絞り込みや
    # 関連リンクの制御に使う
    shop_id: Mapped[int | None] = mapped_column(ForeignKey("shops.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # 同一(category, order_id, item_id)の再発生は新規行を追加せず、この行を更新して集約する
    # (reservation_skipped等、解消されるまで自動リトライのたびに同じ内容が繰り返し記録され、
    # 件数だけが無意味に膨らむのを防ぐ。EventLogService.log参照)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    last_occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
