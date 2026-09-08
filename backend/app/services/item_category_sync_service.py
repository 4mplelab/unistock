from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom_product_setting import BomProductSetting
from app.models.item_category import ItemCategory
from app.models.order import Order, OrderItem
from app.providers.base import IECProvider


class ItemCategorySyncService:
    """BASEの商品カテゴリ情報を定期的に取得し、item_categoriesにキャッシュするサービス。

    カテゴリはBASE側で商品ごとに個別リクエストでしか取得できない(一覧取得APIが無い)ため、
    注文同期のように都度実行するのではなく、対象商品をまとめて低頻度(item_category_sync_scheduler
    参照)で洗い替えする。
    """

    def __init__(self, session: AsyncSession, provider: IECProvider, shop_id: int):
        self._session = session
        self._provider = provider
        self._shop_id = shop_id

    async def _target_item_ids(self) -> set[str]:
        # 過去に注文されたことがある商品(売上のカテゴリ別集計対象)と、BOMを設定済みの商品
        # (未出荷でもBOM画面等で今後使う可能性がある)を対象にする。ショップの全商品を
        # network越しに列挙する専用APIを新たに叩く必要が無く、対象を実用上必要な範囲に絞れる
        ordered_ids = (
            await self._session.execute(
                select(OrderItem.item_id)
                .join(Order, Order.id == OrderItem.order_id)
                .where(Order.shop_id == self._shop_id)
                .distinct()
            )
        ).scalars().all()
        bom_ids = (
            await self._session.execute(
                select(BomProductSetting.item_id).where(BomProductSetting.shop_id == self._shop_id)
            )
        ).scalars().all()
        return set(ordered_ids) | set(bom_ids)

    async def sync(self) -> int:
        """カテゴリ一覧と商品ごとの所属カテゴリを取得し、item_categoriesを洗い替えする。
        戻り値は実際に保存した行数(item_categories)。0の場合、対象商品が無いか、
        BASE側でカテゴリが1つも取得できなかった(未設定またはAPI取得失敗)ことを示す。"""
        item_ids = await self._target_item_ids()
        if not item_ids:
            await self._session.execute(delete(ItemCategory).where(ItemCategory.shop_id == self._shop_id))
            return 0

        categories = await self._provider.list_categories()
        name_by_id = {c.category_id: c.name for c in categories}

        now = datetime.now(timezone.utc)
        rows: list[ItemCategory] = []
        for item_id in item_ids:
            category_ids = await self._provider.get_item_categories(item_id)
            for category_id in category_ids:
                rows.append(
                    ItemCategory(
                        shop_id=self._shop_id,
                        item_id=item_id,
                        category_id=category_id,
                        category_name=name_by_id.get(category_id, "?"),
                        synced_at=now,
                    )
                )

        await self._session.execute(delete(ItemCategory).where(ItemCategory.shop_id == self._shop_id))
        self._session.add_all(rows)
        return len(rows)
