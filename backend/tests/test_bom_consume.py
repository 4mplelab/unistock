"""商品(BOM)単位の直接消費(BomService.consume_item)の回帰テスト。

注文を介さず、選んだ選択肢に該当するBOM行だけ在庫を減らすこと・作成可能数を超えても
ブロックしないこと・dry_runでは在庫が変わらないことを確認する。
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.bom import BomItem, BomItemCondition
from app.models.part import Part
from app.models.shop import Shop
from app.models.stock_movement import StockMovement
from app.schemas.bom import BomConsumeRequest, BomSelectionInput
from app.services.bom_service import BomItemNotFoundError, BomService, NothingToConsumeError


async def _setup(session: AsyncSession) -> tuple[Shop, Part, Part, Assembly]:
    shop = Shop(platform="manual", name="テストショップ", is_active=True)
    common = Part(name="共通部品", stock=10, reserved=2)
    red_only = Part(name="赤専用部品", stock=5, reserved=0)
    assembly = Assembly(name="中間品", stock=3, reserved=0)
    session.add_all([shop, common, red_only, assembly])
    await session.flush()
    session.add_all(
        [
            BomItem(shop_id=shop.id, item_id="item", item_name="商品", component_type="part", part_id=common.id, quantity=2),
            BomItem(
                shop_id=shop.id, item_id="item", item_name="商品", component_type="assembly", assembly_id=assembly.id, quantity=1
            ),
            BomItem(
                shop_id=shop.id,
                item_id="item",
                item_name="商品",
                component_type="part",
                part_id=red_only.id,
                quantity=1,
                conditions=[BomItemCondition(selector_type="variation", selector_id="red", group_name="種類", choice_name="赤")],
            ),
        ]
    )
    await session.commit()
    return shop, common, red_only, assembly


async def test_consume_applies_common_and_selected_lines_only(db_session: AsyncSession):
    shop, common, red_only, assembly = await _setup(db_session)

    result = await BomService(db_session).consume_item(
        shop.id, "item", BomConsumeRequest(quantity=2, selections=[], note="自家用")
    )

    await db_session.refresh(common)
    await db_session.refresh(red_only)
    await db_session.refresh(assembly)
    assert result.consumed
    assert common.stock == 6  # 10 - 2*2
    assert assembly.stock == 1  # 3 - 1*2
    assert red_only.stock == 5  # 赤を選んでいないので消費しない
    movements = (await db_session.execute(select(StockMovement))).scalars().all()
    assert {m.reason for m in movements} == {"direct_consumed"}
    assert all(m.note == "自家用" for m in movements)


async def test_consume_beyond_buildable_goes_negative(db_session: AsyncSession):
    shop, common, red_only, _ = await _setup(db_session)

    result = await BomService(db_session).consume_item(
        shop.id,
        "item",
        BomConsumeRequest(quantity=6, selections=[BomSelectionInput(selector_type="variation", selector_id="red")]),
    )

    await db_session.refresh(common)
    await db_session.refresh(red_only)
    # 共通部品の利用可能は10-2=8、1個あたり2個なので作成可能数は4
    assert result.buildable == 3  # 中間品(在庫3)が律速
    assert common.stock == -2  # 10 - 2*6
    assert red_only.stock == -1  # 5 - 6


async def test_dry_run_does_not_change_stock(db_session: AsyncSession):
    shop, common, _, _ = await _setup(db_session)

    result = await BomService(db_session).consume_item(shop.id, "item", BomConsumeRequest(quantity=5, dry_run=True))

    await db_session.refresh(common)
    assert not result.consumed
    assert result.buildable == 3
    assert common.stock == 10
    assert (await db_session.execute(select(StockMovement))).scalars().all() == []


async def test_consume_unknown_item_raises(db_session: AsyncSession):
    shop, *_ = await _setup(db_session)
    with pytest.raises(BomItemNotFoundError):
        await BomService(db_session).consume_item(shop.id, "missing", BomConsumeRequest(quantity=1))


async def test_consume_with_only_none_lines_raises(db_session: AsyncSession):
    shop = Shop(platform="manual", name="テストショップ", is_active=True)
    db_session.add(shop)
    await db_session.flush()
    db_session.add(BomItem(shop_id=shop.id, item_id="none", component_type="none", quantity=1))
    await db_session.commit()
    with pytest.raises(NothingToConsumeError):
        await BomService(db_session).consume_item(shop.id, "none", BomConsumeRequest(quantity=1))
