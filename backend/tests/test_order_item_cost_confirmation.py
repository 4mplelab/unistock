"""発送確定時にOrderItem.costを確定し、以後単価を変更しても遡って変わらないことの回帰テスト。

過去の実装は原価を都度Part.unit_costから再計算しており、単価変更が過去の注文の粗利にまで
遡って影響してしまう問題があった。発送確定の瞬間に一度だけ確定させる設計に変更した際の
テスト(sales_service.get_sales_summaryの原価計算方式変更に対応)。
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem
from app.models.manual_item import ManualItem
from app.models.order import DispatchStatus, OrderItem
from app.models.part import Part
from app.models.shop import Shop
from app.providers.manual_ec import ManualECProvider
from app.schemas.manual_order import ManualOrderCreate, ManualOrderItemCreate
from app.services.data_reset_service import ConfirmationMismatchError
from app.services.manual_order_service import ManualOrderService
from app.services.order_ingestion_service import OrderIngestionService
from app.services.sales_service import RECALCULATE_COSTS_PHRASE, get_sales_summary, recalculate_order_item_costs


async def _setup_shop_item_and_bom(session: AsyncSession, *, part_unit_cost: int, bom_quantity: int = 2):
    shop = Shop(platform="manual", name="テスト手動ショップ", is_active=True)
    session.add(shop)
    await session.flush()

    part = Part(name="テスト部品", stock=100, reserved=0, unit_cost=part_unit_cost)
    session.add(part)
    await session.flush()

    item_id = "item-1"
    manual_item = ManualItem(shop_id=shop.id, item_id=item_id, title="テスト商品", price=1000, stock=50)
    session.add(manual_item)
    session.add(
        BomItem(
            shop_id=shop.id, item_id=item_id, item_name="テスト商品",
            component_type="part", part_id=part.id, quantity=bom_quantity,
        )
    )
    await session.commit()
    # session.get()はidentity map命中時に再クエリしないため、manual_itemだけ明示的にexpireして
    # 後続のManualOrderService._get_manual_item()がlazy="selectin"のvariationsを
    # 正しく読み込む(unistock-test-async-session-lazy-load-identity-map参照)。
    # expire_all()にするとshop/part自体も無効化され、後でその属性へ素で(await無しで)
    # アクセスした際に同種のMissingGreenletを起こすため、対象を絞る
    session.expire(manual_item)
    return shop, part


async def _dispatch(session: AsyncSession, shop, item_id: str, quantity: int) -> None:
    order_service = ManualOrderService(session)
    order = await order_service.create_order(
        shop.id, ManualOrderCreate(items=[ManualOrderItemCreate(item_id=item_id, quantity=quantity)])
    )
    ingestion = OrderIngestionService(session, ManualECProvider(session, shop.id), shop.id)
    await ingestion.set_manual_dispatch_status(order, DispatchStatus.DISPATCHED.value)
    return order


async def test_dispatch_confirms_order_item_cost_using_cost_at_that_time(db_session: AsyncSession):
    shop, _part = await _setup_shop_item_and_bom(db_session, part_unit_cost=100, bom_quantity=2)

    order = await _dispatch(db_session, shop, "item-1", quantity=3)

    order_item = (
        await db_session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
    ).scalars().one()
    assert order_item.cost == 600  # 単価100 * BOM数量2 * 発注数3


async def test_changing_unit_cost_after_dispatch_does_not_affect_confirmed_cost(db_session: AsyncSession):
    shop, part = await _setup_shop_item_and_bom(db_session, part_unit_cost=100, bom_quantity=2)
    order = await _dispatch(db_session, shop, "item-1", quantity=3)

    # 発送確定後に単価を変更しても、既に確定した原価は変わらない
    part.unit_cost = 999
    await db_session.commit()

    order_item = (
        await db_session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
    ).scalars().one()
    assert order_item.cost == 600

    summary = await get_sales_summary(db_session, days=3650, shop_id=shop.id)
    assert summary.total_cost == 600
    assert summary.total_gross_profit == summary.total_revenue - 600


async def test_recalculate_costs_rejects_wrong_confirm_phrase(db_session: AsyncSession):
    shop, _part = await _setup_shop_item_and_bom(db_session, part_unit_cost=100, bom_quantity=2)
    with pytest.raises(ConfirmationMismatchError):
        await recalculate_order_item_costs(db_session, shop.id, "違う文字列")


async def test_recalculate_costs_overwrites_with_current_unit_cost(db_session: AsyncSession):
    shop, part = await _setup_shop_item_and_bom(db_session, part_unit_cost=100, bom_quantity=2)
    order = await _dispatch(db_session, shop, "item-1", quantity=3)

    # 単価を見直した後、明示的に再計算すれば過去分にも反映される(自動では反映されない)
    part.unit_cost = 500
    await db_session.commit()

    updated_count = await recalculate_order_item_costs(db_session, shop.id, RECALCULATE_COSTS_PHRASE)
    assert updated_count == 1

    order_item = (
        await db_session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
    ).scalars().one()
    assert order_item.cost == 3000  # 単価500 * BOM数量2 * 発注数3
