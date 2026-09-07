from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assembly import Assembly
from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.models.part import Part
from app.schemas.manual_item import ManualItemCreate, ManualItemUpdate
from app.services.assembly_service import InsufficientMaterialStockError
from app.services.bom_service import BomService
from app.services.stock_movement_service import record_assembly_movement, record_part_movement


class ManualItemNotFoundError(Exception):
    pass


class ManualItemAlreadyExistsError(Exception):
    pass


class ManualItemService:
    """外部連携APIを持たないショップ(ManualECProvider参照)の商品マスタ・バリエーションの
    作成/更新/削除。BASEショップの商品はBASE側の管理画面で編集するため、このCRUDは
    手動ショップ専用(manual_itemsテーブル自体が在庫・価格の一次情報になる)。
    """

    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_items(self, shop_id: int) -> list[ManualItem]:
        stmt = (
            select(ManualItem)
            .where(ManualItem.shop_id == shop_id)
            .options(selectinload(ManualItem.variations))
            .order_by(ManualItem.item_id)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get_item(self, shop_id: int, item_id: str) -> ManualItem:
        stmt = (
            select(ManualItem)
            .where(ManualItem.shop_id == shop_id, ManualItem.item_id == item_id)
            .options(selectinload(ManualItem.variations))
        )
        item = (await self._session.execute(stmt)).scalars().one_or_none()
        if item is None:
            raise ManualItemNotFoundError(f"item {shop_id}/{item_id} not found")
        return item

    async def create_item(self, shop_id: int, data: ManualItemCreate) -> ManualItem:
        item = ManualItem(
            shop_id=shop_id,
            item_id=data.item_id,
            title=data.title,
            price=data.price,
            stock=data.stock,
            description=data.description,
        )
        self._session.add(item)
        for v in data.variations:
            self._session.add(
                ManualItemVariation(
                    shop_id=shop_id,
                    item_id=data.item_id,
                    name=v.name,
                    price=v.price,
                    stock=v.stock,
                    sort_order=v.sort_order,
                )
            )
        try:
            await self._session.commit()
        except IntegrityError as e:
            await self._session.rollback()
            raise ManualItemAlreadyExistsError(f"item_id '{data.item_id}' は既に使用されています") from e
        return await self.get_item(shop_id, data.item_id)

    async def update_item(self, shop_id: int, item_id: str, data: ManualItemUpdate) -> ManualItem:
        item = await self.get_item(shop_id, item_id)
        fields = data.model_dump(exclude_unset=True, exclude={"variations"})
        for key in ("title", "price", "stock", "description"):
            if key in fields:
                setattr(item, key, fields[key])

        if data.variations is not None:
            existing_by_id = {v.id: v for v in item.variations}
            keep_ids: set[int] = set()
            for v in data.variations:
                if v.id is not None and v.id in existing_by_id:
                    existing = existing_by_id[v.id]
                    existing.name = v.name
                    existing.price = v.price
                    existing.stock = v.stock
                    existing.sort_order = v.sort_order
                    keep_ids.add(v.id)
                else:
                    self._session.add(
                        ManualItemVariation(
                            shop_id=shop_id,
                            item_id=item_id,
                            name=v.name,
                            price=v.price,
                            stock=v.stock,
                            sort_order=v.sort_order,
                        )
                    )
            # 送られてこなかった既存バリエーションは削除する。BOM条件が既に削除済みの
            # バリエーションを参照するケースは元々あり得る(選択肢の後方互換的な扱いは
            # BomEditPage側のorphan line表示で吸収される)ため、ここでは参照チェックはしない
            for existing_id, existing in existing_by_id.items():
                if existing_id not in keep_ids:
                    await self._session.delete(existing)

        await self._session.commit()
        return await self.get_item(shop_id, item_id)

    async def delete_item(self, shop_id: int, item_id: str) -> None:
        item = await self.get_item(shop_id, item_id)
        await self._session.delete(item)
        await self._session.commit()

    async def consume_stock(
        self, shop_id: int, item_id: str, quantity: int, variation_id: int | None, note: str | None
    ) -> ManualItem:
        """注文を作らずに、この商品(またはバリエーション)の在庫と、BOMで紐付いた部品/中間品の
        在庫をまとめて減らす。中間品の組立記録(AssemblyService.build_assembly)と対称的な操作で、
        同じく単層(BOMの先のレシピまでは遡らない)・先に全行を検証してからまとめて減算する方式。
        """
        item = await self.get_item(shop_id, item_id)

        variation: ManualItemVariation | None = None
        if variation_id is not None:
            variation = next((v for v in item.variations if v.id == variation_id), None)
            if variation is None:
                raise ManualItemNotFoundError(f"variation {variation_id} not found")
        elif item.variations:
            # バリエーションを持つ商品は、必ずどれかのバリエーションを経由してのみ在庫を
            # 動かせる(共通/本体の在庫が、バリエーションを介さず独立に売れているように
            # 見えてしまうのを避けるため)
            raise ValueError(f"「{item.title}」はバリエーションの選択が必要です")

        if variation is not None:
            if variation.stock < quantity:
                raise InsufficientMaterialStockError(
                    f"「{item.title} / {variation.name}」の在庫が不足しています"
                    f"(必要:{quantity}, 在庫:{variation.stock})"
                )
        elif item.stock < quantity:
            raise InsufficientMaterialStockError(
                f"「{item.title}」の在庫が不足しています(必要:{quantity}, 在庫:{item.stock})"
            )

        bom_lines = await BomService(self._session).get_bom_for_item(shop_id, item_id)
        selected_keys = {("variation", str(variation_id))} if variation_id is not None else set()
        applicable = [
            line
            for line in bom_lines
            if all((c.selector_type, c.selector_id) in selected_keys for c in line.conditions)
        ]

        locked_parts: dict[int, Part] = {}
        locked_assemblies: dict[int, Assembly] = {}
        for line in applicable:
            if line.part_id is None and line.assembly_id is None:
                continue  # component_type='none'(部品不要マーカー)
            required = line.quantity * quantity
            if line.part_id is not None:
                if line.part_id not in locked_parts:
                    result = await self._session.execute(
                        select(Part).where(Part.id == line.part_id).with_for_update()
                    )
                    locked_parts[line.part_id] = result.scalars().one()
                part = locked_parts[line.part_id]
                available = part.stock - part.reserved
                if available < required:
                    raise InsufficientMaterialStockError(
                        f"部品「{part.name}」の在庫が不足しています(必要:{required}, 利用可能:{available})"
                    )
            else:
                if line.assembly_id not in locked_assemblies:
                    result = await self._session.execute(
                        select(Assembly).where(Assembly.id == line.assembly_id).with_for_update()
                    )
                    locked_assemblies[line.assembly_id] = result.scalars().one()
                assembly = locked_assemblies[line.assembly_id]
                available = assembly.stock - assembly.reserved
                if available < required:
                    raise InsufficientMaterialStockError(
                        f"中間品「{assembly.name}」の在庫が不足しています(必要:{required}, 利用可能:{available})"
                    )

        for line in applicable:
            if line.part_id is None and line.assembly_id is None:
                continue
            required = line.quantity * quantity
            if line.part_id is not None:
                locked_parts[line.part_id].stock -= required
                await record_part_movement(
                    self._session,
                    line.part_id,
                    -required,
                    reason="manual_item_consumed",
                    note=note,
                    shop_id=shop_id,
                )
            else:
                locked_assemblies[line.assembly_id].stock -= required
                await record_assembly_movement(
                    self._session,
                    line.assembly_id,
                    -required,
                    reason="manual_item_consumed",
                    note=note,
                    shop_id=shop_id,
                )

        if variation is not None:
            variation.stock -= quantity
        else:
            item.stock -= quantity

        await self._session.commit()
        return await self.get_item(shop_id, item_id)
