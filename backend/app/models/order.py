import enum
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DispatchStatus(str, enum.Enum):
    UNSHIPPABLE = "unshippable"
    ORDERED = "ordered"
    UNPAID = "unpaid"
    SHIPPING = "shipping"
    DISPATCHED = "dispatched"
    CANCELLED = "cancelled"


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("shop_id", "unique_key", name="uq_orders_shop_id_unique_key"),
        CheckConstraint("total IS NULL OR total >= 0", name="ck_orders_total"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), nullable=False)
    platform: Mapped[str] = mapped_column(String(20), nullable=False, default="base")
    unique_key: Mapped[str] = mapped_column(String(64), nullable=False)
    dispatch_status: Mapped[str] = mapped_column(String(20), nullable=False)
    ordered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # detail取得済みフラグ。再ポーリング時に同じ注文へ重複してget_order_detailを呼ばないようにする
    items_fetched: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # dispatch_status(連携先ショップの状態のローカル複製)がdispatched/cancelledになった時点で
    # _consume/_releaseによる実際の在庫増減が完了したかどうか。dispatch_statusの更新自体は
    # 常に成功させる一方、在庫操作は技術的な要因で失敗する可能性があるため分離して管理し、
    # Falseのままの注文は次回ポーリング時に自動的に再試行する
    stock_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # BASEのorders/detailが返す注文合計金額(商品単価+オプション単価の合計 - 割引 -
    # コイン割引 + 代引き手数料 + 調整額。BASE側でキャンセル済みの商品は最初から
    # 除外された値)。詳細取得(_ingest_new_order/recheck_status)のたびに最新値へ
    # 更新するため、発送確定前の商品単位キャンセルによる金額変動にも追従する。
    # 発送確定後はBASE仕様上キャンセル不可のためこの値も変動しない。
    # detail未取得の注文、この列追加より前に取り込まれた注文はNULLのまま残る
    total: Mapped[int | None] = mapped_column(Integer)

    # 顧客情報(注文サマリのブラッシュアップ出力用途)
    last_name: Mapped[str | None] = mapped_column(String(255))
    first_name: Mapped[str | None] = mapped_column(String(255))
    prefecture: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("total IS NULL OR total >= 0", name="ck_order_items_total"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[int | None] = mapped_column(Integer)
    # BASEの注文商品単位の合計金額(単価+オプション単価の合計を数量分。price×quantityだけでは
    # 商品オプションの追加料金が反映されないため、商品別売上の集計にはこちらを優先して使う)。
    # 新規取り込み時にのみ設定する(price同様、成立後に値が変わることは想定しない)。
    # この列追加より前に取り込まれた行はNULLのまま残る
    total: Mapped[int | None] = mapped_column(Integer)
    # BASEの単一属性バリエーション(例: 色)。option_id等を持つ「options」(OrderItemOption)とは別の仕組み。
    variation_id: Mapped[str | None] = mapped_column(String(64))
    variation: Mapped[str | None] = mapped_column(String(255))
    # BASEの注文明細行のstatus("ordered"/"cancelled"等)。注文全体(Order.dispatch_status)とは
    # 独立していて、注文はordered(未対応)のままその中の1商品だけキャンセルされることがある。
    # ordered以外(=cancelled)の商品は部品引当・ピッキング対象から除外する
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ordered")
    # BASEの注文明細行ID(order_items[].order_item_id)。再同期時に既存行と対応付けるための
    # キー(item_id+variation_idだけでは同一商品を複数回注文した場合に一意にならないため)。
    # この列追加前に取り込んだ行はNULLのまま残り、その場合はitem_id+variation_idで代替照合する
    base_order_item_id: Mapped[str | None] = mapped_column(String(64))
    # BOM未設定・選択内容に一致するBOM行が無い等の理由で部品引当(_reserve)がスキップされた
    # 場合はFalseのまま残る。後からBOMが整備された際に、この行だけ次回同期時に再試行される
    reservation_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # ピッキング(部品・中間品を集める作業)が完了したかどうか。UniStock内だけで完結する
    # チェックで、連携先のdispatch_statusとは無関係(ピッキング後も実際の発送確定まではordered
    # のまま)。ピッキングページで一覧に残したまま見た目だけ変えるための表示用フラグ
    picked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrderItemOption(Base):
    """注文明細行が選択したBASE商品オプション(オプショングループ+選択肢)を記録する。

    BOM(bom_items)のオプション別行をどれ適用すべきか、注文取り込み時にここから判定する。
    """

    __tablename__ = "order_item_options"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), nullable=False)
    option_id: Mapped[str] = mapped_column(String(64), nullable=False)
    option_variation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    option_name: Mapped[str | None] = mapped_column(String(255))
    option_value: Mapped[str | None] = mapped_column(String(255))
    # BASEの注文明細API(/orders/detail)が返すoptions配列は表示順を保証しないため、
    # 商品側のlist_order(BASEの表示順)を突き合わせて取り込み時に記録する。表示時はこの列でソートする。
    sort_order: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
