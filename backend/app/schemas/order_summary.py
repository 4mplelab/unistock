from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.order import OrderItemOptionRead


class PickListEntryRead(BaseModel):
    component_type: str  # "part" | "assembly"
    id: int
    name: str
    quantity: int
    # 部品のグループ・カラー(ピッキング時に現物を識別する手がかりとして表示する)。
    # 中間品(assembly)にはこの概念が無いため常にNone
    group: str | None = None
    colors: list[str] | None = None


class OrderSummaryItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: str
    title: str | None
    quantity: int
    variation: str | None
    # BASEの注文明細行のstatus("ordered"/"cancelled"等)。注文全体(dispatch_status)とは独立
    # していて、商品単位でBASE側だけキャンセルされることがある。cancelledの商品は部品引当・
    # ピッキング対象から除外済み(pick_listは常に空、reservation_appliedはTrue)
    status: str
    options: list[OrderItemOptionRead] = []
    # BOM未設定・選択内容に一致するBOM行が無い等の理由で部品引当がスキップされたまま
    # (次回同期時に再試行される)。Falseの場合、この商品のpick_listは空になる
    reservation_applied: bool
    # ピッキング(部品・中間品を集める作業)が完了したかどうか。BASEのdispatch_statusとは
    # 無関係のUniStock内だけの表示用フラグ
    picked: bool
    # order_part_reservations(実際に引当てた最終的な消費計画)を、この商品(order_item)の
    # 分だけ部品/中間品ごとに集計したもの。中間品在庫優先・不足分は構成部品まで自動分解、
    # というロジックは_resolve_component(order_ingestion_service)で引当時に計算済みのため、
    # ここでは再計算せず読み出すだけ
    pick_list: list[PickListEntryRead]
    # bom_product_settings.matrix_layoutの値。true の商品は注文一覧PDFでオプションを
    # 横並びの表にまとめる(旧Excel版の注文サマリのような形式)。falseならピッキング画面と
    # 同じカード形式(必要な部品・中間品付き)で出力する
    matrix_layout: bool = False


class OrderSummaryRow(BaseModel):
    id: int
    shop_id: int
    unique_key: str
    ordered_at: datetime
    last_name: str | None
    first_name: str | None
    prefecture: str | None
    address: str | None
    items: list[OrderSummaryItemRead]
    has_unresolved_items: bool


class OrderSummaryRead(BaseModel):
    orders: list[OrderSummaryRow]
    aggregate: list[PickListEntryRead]
