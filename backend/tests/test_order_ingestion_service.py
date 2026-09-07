"""注文の部品引当・消費・解放(OrderIngestionService)の回帰テスト。

過去に実際の在庫不整合の事故があった箇所のため、「注文作成で引当→発送確定で消費→
キャンセルで解放」という一連の流れを、実DBに対して一気通貫で確認する。
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem
from app.models.manual_item import ManualItem
from app.models.order import DispatchStatus
from app.models.part import Part
from app.models.shop import Shop
from app.providers.manual_ec import ManualECProvider
from app.schemas.manual_order import ManualOrderCreate, ManualOrderItemCreate
from app.services.manual_order_service import ManualOrderService
from app.services.order_ingestion_service import OrderIngestionService


async def _setup_shop_item_and_bom(
    session: AsyncSession, *, part_stock: int, bom_quantity: int, item_id: str = "item-1"
) -> tuple[Shop, Part, ManualItem]:
    shop = Shop(platform="manual", name="テスト手動ショップ", is_active=True)
    session.add(shop)
    await session.flush()

    part = Part(name="テスト部品", stock=part_stock, reserved=0)
    session.add(part)
    await session.flush()

    item = ManualItem(shop_id=shop.id, item_id=item_id, title="テスト商品", price=1000, stock=50)
    session.add(item)

    session.add(
        BomItem(
            shop_id=shop.id,
            item_id=item_id,
            item_name="テスト商品",
            component_type="part",
            part_id=part.id,
            quantity=bom_quantity,
        )
    )
    await session.commit()
    # session.get()はidentity map命中時に再クエリしないため、明示的にexpireして
    # 後続のManualOrderService._get_manual_item()がlazy="selectin"のvariationsを
    # 正しく読み込む(実アプリではリクエストごとに新規セッションのためこの問題は起きない)
    session.expire(item)
    return shop, part, item


async def test_ingest_manual_order_reserves_bom_parts(db_session: AsyncSession):
    shop, part, _item = await _setup_shop_item_and_bom(db_session, part_stock=100, bom_quantity=2)

    service = ManualOrderService(db_session)
    order = await service.create_order(
        shop.id,
        ManualOrderCreate(items=[ManualOrderItemCreate(item_id="item-1", quantity=3)]),
    )

    await db_session.refresh(part)
    assert order.dispatch_status == DispatchStatus.ORDERED.value
    assert part.reserved == 6  # quantity(2) * 発注数(3)
    assert part.stock == 100  # 引当段階では実在庫は減らない


async def test_dispatch_consumes_reserved_stock(db_session: AsyncSession):
    shop, part, _item = await _setup_shop_item_and_bom(db_session, part_stock=100, bom_quantity=2)
    order_service = ManualOrderService(db_session)
    order = await order_service.create_order(
        shop.id,
        ManualOrderCreate(items=[ManualOrderItemCreate(item_id="item-1", quantity=3)]),
    )

    ingestion = OrderIngestionService(db_session, ManualECProvider(db_session, shop.id), shop.id)
    await ingestion.set_manual_dispatch_status(order, DispatchStatus.DISPATCHED.value)

    await db_session.refresh(part)
    assert part.reserved == 0
    assert part.stock == 94  # 100 - (2 * 3)


async def test_cancel_releases_reservation_without_consuming_stock(db_session: AsyncSession):
    shop, part, _item = await _setup_shop_item_and_bom(db_session, part_stock=100, bom_quantity=2)
    order_service = ManualOrderService(db_session)
    order = await order_service.create_order(
        shop.id,
        ManualOrderCreate(items=[ManualOrderItemCreate(item_id="item-1", quantity=3)]),
    )

    ingestion = OrderIngestionService(db_session, ManualECProvider(db_session, shop.id), shop.id)
    await ingestion.set_manual_dispatch_status(order, DispatchStatus.CANCELLED.value)

    await db_session.refresh(part)
    assert part.reserved == 0
    assert part.stock == 100  # キャンセルでは実在庫は変動しない(引当解除のみ)
