from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem, BomItemCondition
from app.models.bom_product_setting import BomProductSetting
from app.models.event_log import EventLog
from app.models.item_category import ItemCategory
from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.models.manual_order_import_profile import ManualOrderImportProfile
from app.models.oauth_token import ECOAuthToken
from app.models.order import Order, OrderItem, OrderItemOption
from app.models.order_reservation import OrderPartReservation
from app.models.purchase_order import PurchaseOrder
from app.models.shop import Shop
from app.models.stock_movement import StockMovement
from app.models.stock_schedule import StockSchedule
from app.services.data_reset_service import ConfirmationMismatchError

DELETE_SHOP_PHRASE = "ショップを削除"


class ShopNotFoundError(Exception):
    pass


class ShopService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_shops(self, active_only: bool = False) -> list[Shop]:
        stmt = select(Shop).order_by(Shop.id)
        if active_only:
            stmt = stmt.where(Shop.is_active.is_(True))
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get_shop(self, shop_id: int) -> Shop:
        shop = await self._session.get(Shop, shop_id)
        if shop is None:
            raise ShopNotFoundError(f"shop {shop_id} not found")
        return shop

    async def create_shop(self, platform: str, name: str) -> Shop:
        shop = Shop(platform=platform, name=name)
        self._session.add(shop)
        await self._session.commit()
        await self._session.refresh(shop)
        return shop

    async def update_shop(
        self, shop_id: int, name: str | None, is_active: bool | None, platform: str | None = None
    ) -> Shop:
        shop = await self.get_shop(shop_id)
        if name is not None:
            shop.name = name
        if is_active is not None:
            shop.is_active = is_active
        if platform is not None and platform != shop.platform:
            # 現状はBASE→手動管理化のみ許可する。手動→BASE等の逆方向は、手動ショップの
            # 商品マスタ(manual_items)がBASE側に何も対応しないため安全に成立しない
            if shop.platform != "base" or platform != "manual":
                raise ValueError("このプラットフォームの変更はサポートされていません")
            shop.platform = platform
            token = await self._session.get(ECOAuthToken, shop_id)
            if token is not None:
                await self._session.delete(token)
        await self._session.commit()
        await self._session.refresh(shop)
        return shop

    async def delete_shop(self, shop_id: int, confirm_phrase: str) -> None:
        """ショップと、紐づく注文/BOM/発注/リストック予約/手動登録商品などの全データを
        完全に削除する(全データ削除と同じ「確認文字列の入力必須」パターンで誤操作を防ぐ)。
        子から親の順(FK制約を回避するため)に削除する。共有マスタ(Part/Assembly)は
        他ショップから参照されうるため対象外。"""
        shop = await self.get_shop(shop_id)

        if confirm_phrase != DELETE_SHOP_PHRASE:
            raise ConfirmationMismatchError(
                f"確認文字列が一致しません。「{DELETE_SHOP_PHRASE}」と入力してください"
            )

        order_ids = select(Order.id).where(Order.shop_id == shop_id)
        order_item_ids = select(OrderItem.id).where(OrderItem.order_id.in_(order_ids))
        bom_item_ids = select(BomItem.id).where(BomItem.shop_id == shop_id)

        await self._session.execute(delete(EventLog).where(EventLog.shop_id == shop_id))
        await self._session.execute(
            delete(OrderPartReservation).where(OrderPartReservation.order_id.in_(order_ids))
        )
        await self._session.execute(
            delete(OrderItemOption).where(OrderItemOption.order_item_id.in_(order_item_ids))
        )
        await self._session.execute(delete(OrderItem).where(OrderItem.order_id.in_(order_ids)))
        await self._session.execute(delete(Order).where(Order.shop_id == shop_id))
        await self._session.execute(delete(StockMovement).where(StockMovement.shop_id == shop_id))
        await self._session.execute(delete(PurchaseOrder).where(PurchaseOrder.shop_id == shop_id))
        await self._session.execute(delete(StockSchedule).where(StockSchedule.shop_id == shop_id))
        await self._session.execute(
            delete(BomItemCondition).where(BomItemCondition.bom_item_id.in_(bom_item_ids))
        )
        await self._session.execute(delete(BomItem).where(BomItem.shop_id == shop_id))
        await self._session.execute(delete(BomProductSetting).where(BomProductSetting.shop_id == shop_id))
        await self._session.execute(
            delete(ManualItemVariation).where(ManualItemVariation.shop_id == shop_id)
        )
        await self._session.execute(delete(ManualItem).where(ManualItem.shop_id == shop_id))
        await self._session.execute(delete(ItemCategory).where(ItemCategory.shop_id == shop_id))
        await self._session.execute(
            delete(ManualOrderImportProfile).where(ManualOrderImportProfile.shop_id == shop_id)
        )
        await self._session.execute(delete(ECOAuthToken).where(ECOAuthToken.shop_id == shop_id))

        await self._session.delete(shop)
        await self._session.commit()
