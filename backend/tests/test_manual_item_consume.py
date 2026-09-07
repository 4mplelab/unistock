"""手動商品の「注文なし在庫消費」(ManualItemService.consume_stock)の回帰テスト。

中間品の組立記録(AssemblyService.build_assembly)と対称的な、今セッションで新規に
追加した機能。BOM連動の在庫減算・バリエーション必須化・在庫不足時のロールバックを確認する。
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem, BomItemCondition
from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.models.part import Part
from app.models.shop import Shop
from app.services.assembly_service import InsufficientMaterialStockError
from app.services.manual_item_service import ManualItemService


async def _make_shop(session: AsyncSession) -> Shop:
    shop = Shop(platform="manual", name="テスト手動ショップ", is_active=True)
    session.add(shop)
    await session.flush()
    return shop


async def test_consume_without_variation_decrements_item_and_bom_part(db_session: AsyncSession):
    shop = await _make_shop(db_session)
    part = Part(name="部品A", stock=100, reserved=0)
    db_session.add(part)
    await db_session.flush()
    item = ManualItem(shop_id=shop.id, item_id="simple", title="単純商品", price=500, stock=50)
    db_session.add(item)
    db_session.add(
        BomItem(shop_id=shop.id, item_id="simple", component_type="part", part_id=part.id, quantity=2)
    )
    await db_session.commit()

    service = ManualItemService(db_session)
    result = await service.consume_stock(shop.id, "simple", quantity=3, variation_id=None, note=None)

    await db_session.refresh(part)
    assert result.stock == 47  # 50 - 3
    assert part.stock == 94  # 100 - (2 * 3)


async def test_consume_requires_variation_when_item_has_variations(db_session: AsyncSession):
    shop = await _make_shop(db_session)
    item = ManualItem(shop_id=shop.id, item_id="variant", title="バリエーションあり商品", stock=50)
    db_session.add(item)
    db_session.add(ManualItemVariation(shop_id=shop.id, item_id="variant", name="赤", price=1000, stock=10))
    await db_session.commit()

    service = ManualItemService(db_session)
    with pytest.raises(ValueError, match="バリエーションの選択が必要"):
        await service.consume_stock(shop.id, "variant", quantity=1, variation_id=None, note=None)


async def test_consume_raises_and_rolls_back_when_part_stock_insufficient(db_session: AsyncSession):
    shop = await _make_shop(db_session)
    part = Part(name="在庫僅少部品", stock=2, reserved=0)
    db_session.add(part)
    await db_session.flush()
    item = ManualItem(shop_id=shop.id, item_id="tight", title="商品", stock=50)
    db_session.add(item)
    db_session.add(
        BomItem(shop_id=shop.id, item_id="tight", component_type="part", part_id=part.id, quantity=2)
    )
    await db_session.commit()

    service = ManualItemService(db_session)
    # 数量2 * BOM2個 = 必要4個 > 在庫2個 なので不足エラーになる
    with pytest.raises(InsufficientMaterialStockError):
        await service.consume_stock(shop.id, "tight", quantity=2, variation_id=None, note=None)

    await db_session.refresh(part)
    await db_session.refresh(item)
    assert part.stock == 2  # 何も変更されていない
    assert item.stock == 50


async def test_consume_specific_variation_only_applies_matching_bom_condition(db_session: AsyncSession):
    shop = await _make_shop(db_session)
    common_part = Part(name="共通部品", stock=100, reserved=0)
    red_only_part = Part(name="赤専用部品", stock=100, reserved=0)
    db_session.add_all([common_part, red_only_part])
    await db_session.flush()

    item = ManualItem(shop_id=shop.id, item_id="colored", title="色違い商品", stock=0)
    db_session.add(item)
    red = ManualItemVariation(shop_id=shop.id, item_id="colored", name="赤", price=1000, stock=20)
    blue = ManualItemVariation(shop_id=shop.id, item_id="colored", name="青", price=1000, stock=20)
    db_session.add_all([red, blue])
    await db_session.flush()

    common_bom = BomItem(
        shop_id=shop.id, item_id="colored", component_type="part", part_id=common_part.id, quantity=1
    )
    red_bom = BomItem(
        shop_id=shop.id, item_id="colored", component_type="part", part_id=red_only_part.id, quantity=1
    )
    db_session.add_all([common_bom, red_bom])
    await db_session.flush()
    db_session.add(
        BomItemCondition(bom_item_id=red_bom.id, selector_type="variation", selector_id=str(red.id))
    )
    await db_session.commit()

    service = ManualItemService(db_session)
    await service.consume_stock(shop.id, "colored", quantity=1, variation_id=red.id, note=None)

    await db_session.refresh(common_part)
    await db_session.refresh(red_only_part)
    await db_session.refresh(red)
    await db_session.refresh(blue)
    assert common_part.stock == 99  # 共通行は常に消費される
    assert red_only_part.stock == 99  # 赤専用行も消費される
    assert red.stock == 19
    assert blue.stock == 20  # 青には影響しない
