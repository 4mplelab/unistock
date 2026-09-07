from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.assembly_item import AssemblyItem
from app.models.bom import BomItem, BomItemCondition
from app.models.bom_product_setting import BomProductSetting
from app.models.event_log import EventLog
from app.models.item_category import ItemCategory
from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.models.oauth_token import ECOAuthToken
from app.models.order import Order, OrderItem, OrderItemOption
from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.models.purchase_order import PurchaseOrder
from app.models.shop import Shop
from app.models.stock_movement import StockMovement
from app.models.stock_schedule import StockSchedule

RESET_ALL_PHRASE = "全データ削除"
RESET_ORDER_HISTORY_PHRASE = "注文履歴削除"


class ConfirmationMismatchError(Exception):
    pass


class FeatureDisabledError(Exception):
    pass


class DataResetService:
    """デモデータの一括消去・注文履歴のみの消去を行う。

    ショップ連携の認証情報(ECOAuthToken)・アプリ設定(AppSetting)は、どちらの操作でも
    一切触れない(消してしまうと再認証・再設定からやり直しになるため)。
    """

    def __init__(self, session: AsyncSession):
        self._session = session

    async def reset_all(self, confirm_phrase: str) -> None:
        """業務データを全て削除する(demo_mode中は使えない。scripts/seed_demo_data.py
        で投入したサンプルデータの後片付け等、本番移行前のリセット用途を想定)。"""
        if confirm_phrase != RESET_ALL_PHRASE:
            raise ConfirmationMismatchError(
                f"確認文字列が一致しません。「{RESET_ALL_PHRASE}」と入力してください"
            )

        # 子から親の順(FK制約を回避するため)
        await self._session.execute(delete(EventLog))
        await self._session.execute(delete(OrderPartReservation))
        await self._session.execute(delete(OrderItemOption))
        await self._session.execute(delete(OrderItem))
        await self._session.execute(delete(Order))
        await self._session.execute(delete(PurchaseOrder))
        await self._session.execute(delete(StockSchedule))
        await self._session.execute(delete(StockMovement))
        await self._session.execute(delete(BomItemCondition))
        await self._session.execute(delete(BomItem))
        await self._session.execute(delete(BomProductSetting))
        await self._session.execute(delete(AssemblyItem))
        await self._session.execute(delete(Assembly))
        await self._session.execute(delete(Part))
        await self._session.execute(delete(ManualItemVariation))
        await self._session.execute(delete(ManualItem))
        await self._session.execute(delete(ItemCategory))
        await self._session.commit()

    async def reset_shops(self) -> None:
        """ショップと連携トークンを全て削除する。デモ⇔通常モード切替専用
        (demo_mode_state.py)。デモモード中はOAuth連携API自体を塞いでいるため
        本番トークンが存在するリスクは無く、reset_all()と違って確認フレーズは要らない。
        shop_idを参照する他テーブル(bom_items等)を先に空にしておくため、
        reset_all()の後に呼ぶこと"""
        await self._session.execute(delete(ECOAuthToken))
        await self._session.execute(delete(Shop))
        await self._session.commit()

    async def reset_order_history(self, confirm_phrase: str) -> None:
        """一時的に無効化している(2026-09-04)。

        orders/order_items/order_item_options/order_part_reservationsは、注文単位・
        商品単位の売上高/原価(将来対応)を計算できる唯一の元データであり、経理帳簿と
        同じ性質を持つ経営情報である。行ごと物理削除すると再現不可能な形で失われるため、
        氏名・住所・メールアドレスだけを匿名化する方式に置き換えるまでこの操作は無効化する。
        """
        raise FeatureDisabledError(
            "注文履歴の消去は現在一時的に無効化しています"
            "(売上・原価の記録を残したまま個人情報だけを消す方式に変更するまでの措置です)"
        )
