from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.providers.base import (
    CategoryInfo,
    ECPlatform,
    IECProvider,
    ItemInfo,
    ItemOption,
    ItemUpdateResult,
    ItemVariation,
    OrderDetail,
    OrderSummary,
    StockUpdateResult,
)

class ManualECProvider(IECProvider):
    """外部連携APIを持たないショップ(ECPlatform.MANUAL)用のプロバイダ。BASEへは一切通信せず、
    手動登録された商品マスタ(manual_items/manual_item_variations)だけで完結させる。

    在庫・商品情報を都度取得しに行く先(BASE)が無いため、manual_itemsテーブル自体がここでの
    「在庫の一次情報」になる(update_stockもここへ直接書き込む)。注文はポーリング
    (list_orders/get_order_detail)ではなく、手動フォーム/CSVからの直接登録
    (OrderIngestionService.ingest_manual_order)で取り込むため、この2メソッドは常に空を返す。
    オプション(複数グループの組み合わせ)は対象外で、単一軸のバリエーションのみ対応する。
    """

    platform = ECPlatform.MANUAL

    def __init__(self, session: AsyncSession, shop_id: int):
        self._session = session
        self._shop_id = shop_id

    async def _get_manual_item(self, item_id: str) -> ManualItem | None:
        return await self._session.get(ManualItem, {"shop_id": self._shop_id, "item_id": item_id})

    async def update_stock(self, item_id: str, quantity: int) -> StockUpdateResult:
        item = await self._get_manual_item(item_id)
        if item is None:
            return StockUpdateResult(
                success=False,
                platform=self.platform,
                item_id=item_id,
                requested_stock=quantity,
                error_message="商品が見つかりません",
            )
        item.stock = quantity
        return StockUpdateResult(
            success=True,
            platform=self.platform,
            item_id=item_id,
            requested_stock=quantity,
            http_status=200,
        )

    async def get_item(self, item_id: str) -> ItemInfo | None:
        item = await self._get_manual_item(item_id)
        if item is None:
            return None
        return ItemInfo(item_id=item.item_id, title=item.title, stock=item.stock)

    async def list_items(self, limit: int = 50, offset: int = 0) -> list[ItemInfo]:
        stmt = (
            select(ManualItem)
            .where(ManualItem.shop_id == self._shop_id)
            .order_by(ManualItem.item_id)
            .limit(limit)
            .offset(offset)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [ItemInfo(item_id=row.item_id, title=row.title, stock=row.stock) for row in rows]

    async def update_item_description(self, item_id: str, detail: str) -> ItemUpdateResult:
        item = await self._get_manual_item(item_id)
        if item is None:
            return ItemUpdateResult(success=False, platform=self.platform, item_id=item_id, error_message="商品が見つかりません")
        item.description = detail
        return ItemUpdateResult(success=True, platform=self.platform, item_id=item_id, http_status=200)

    async def list_orders(
        self, start_ordered: datetime, end_ordered: datetime | None = None
    ) -> list[OrderSummary]:
        # 手動注文はOrderIngestionService.ingest_manual_order()で直接取り込むため、
        # ポーリング経路(sync())では常に「新規注文なし」を返す
        return []

    async def get_order_detail(self, unique_key: str) -> OrderDetail | None:
        return None

    async def get_item_options(self, item_id: str) -> list[ItemOption]:
        # 複数グループを組み合わせる「オプション」機構は対象外(単一軸のバリエーションのみ対応)
        return []

    async def get_item_variations(self, item_id: str) -> list[ItemVariation]:
        stmt = (
            select(ManualItemVariation)
            .where(ManualItemVariation.shop_id == self._shop_id, ManualItemVariation.item_id == item_id)
            .order_by(ManualItemVariation.sort_order, ManualItemVariation.id)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [
            ItemVariation(variation_id=str(row.id), variation_name=row.name, stock=row.stock) for row in rows
        ]

    async def list_categories(self) -> list[CategoryInfo]:
        # 手動ショップにはBASEのようなカテゴリ概念が無いため対象外
        return []

    async def get_item_categories(self, item_id: str) -> list[int]:
        return []
