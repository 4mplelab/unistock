import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class NotificationAlertCategory(str, enum.Enum):
    REORDER_THRESHOLD = "reorder_threshold"
    PO_OVERDUE = "po_overdue"
    BUILDABLE_THRESHOLD = "buildable_threshold"


class NotificationAlertState(Base):
    """状態ベースの通知(発注点割れ・発注の納期超過・商品の作成可能数閾値割れ)のdedup状態。

    resolved_atがNULLの行が「現在アクティブなアラート」。条件を初めて満たした時に行を作成して
    通知し、条件が解消したらresolved_atを立てる(次に再び条件を満たしたら新しい行を作り直して
    再通知できるようにする、edge-triggeredな設計)。(category, target_key)につきアクティブな
    行は同時に1件まで(DB側の部分ユニークインデックスで保証)。

    target_keyは対象を一意に表す文字列(例: "part:12", "purchase_order:34",
    "item:1:123456789")。カテゴリごとに対象の種類が違うため、専用の外部キー列ではなく
    汎用の文字列にしている。
    """

    __tablename__ = "notification_alert_states"
    __table_args__ = (
        CheckConstraint(
            "category IN ('reorder_threshold', 'po_overdue', 'buildable_threshold')",
            name="ck_notification_alert_states_category",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    target_key: Mapped[str] = mapped_column(String(255), nullable=False)
    first_triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
