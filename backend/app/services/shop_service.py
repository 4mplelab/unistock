from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem
from app.models.manual_item import ManualItem
from app.models.oauth_token import ECOAuthToken
from app.models.order import Order
from app.models.shop import Shop
from app.models.stock_schedule import StockSchedule


class ShopNotFoundError(Exception):
    pass


class ShopHasDataError(Exception):
    """注文/BOM等の紐づくデータが残っているショップは削除できない(誤操作でのデータ消失防止)。"""


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

    async def delete_shop(self, shop_id: int) -> None:
        shop = await self.get_shop(shop_id)

        for model in (Order, BomItem, StockSchedule, ManualItem):
            result = await self._session.execute(select(model.shop_id).where(model.shop_id == shop_id).limit(1))
            if result.scalar_one_or_none() is not None:
                raise ShopHasDataError(
                    "このショップには注文/BOM/リストック予約/手動登録した商品のデータが残っているため"
                    "削除できません。「無効化」で連携を止めることはできます。"
                )

        token = await self._session.get(ECOAuthToken, shop_id)
        if token is not None:
            await self._session.delete(token)

        await self._session.delete(shop)
        await self._session.commit()
