from pydantic import BaseModel


class NavCountsRead(BaseModel):
    """サイドバーの通知バッジに表示する各件数。"""

    orders_unaddressed: int  # 注文: 未対応(dispatch_status=ordered)の注文数
    picking_incomplete: int  # ピッキング: 未対応注文のうち、未ピッキングの明細が1件以上残る注文数
    event_logs_error: int  # イベントログ: level=errorの件数
    schedules_pending: int  # リストック予約: status=pendingの件数
    purchase_orders_ordered: int  # 発注管理: status=ordered(未入荷)の件数
