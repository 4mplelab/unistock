"""手動注文CSVインポート(ManualOrderService.import_csv/preview_csv)の回帰テスト。

固定フォーマットへの後方互換、任意の列マッピング、行のグループ化、エラー行の報告、
ヘッダー無しCSV対応など、分岐が多く壊れやすい箇所をまとめて確認する。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_item import ManualItem
from app.models.order import Order, OrderItem
from app.models.shop import Shop
from app.schemas.manual_order_import_profile import ManualOrderCsvColumnMapping
from app.services.manual_order_service import ManualOrderService


async def _make_shop_with_item(session: AsyncSession, item_id: str = "item-1") -> Shop:
    shop = Shop(platform="manual", name="テスト手動ショップ", is_active=True)
    session.add(shop)
    await session.flush()
    session.add(ManualItem(shop_id=shop.id, item_id=item_id, title="テスト商品", price=1000, stock=100))
    await session.commit()
    return shop


async def test_import_csv_default_mapping_is_backward_compatible(db_session: AsyncSession):
    shop = await _make_shop_with_item(db_session)
    csv_text = (
        "order_ref,ordered_at,last_name,first_name,prefecture,address,email,"
        "item_id,quantity,variation_name,price\n"
        "REF-1,,山田,太郎,,,,item-1,2,,1000\n"
    )

    service = ManualOrderService(db_session)
    result = await service.import_csv(shop.id, csv_text)  # mapping省略=固定フォーマット

    assert result.created == 1
    assert result.errors == []


async def test_import_csv_with_custom_mapping(db_session: AsyncSession):
    shop = await _make_shop_with_item(db_session)
    csv_text = "注文ID,商品コード,数量\nREF-1,item-1,3\n"
    mapping = ManualOrderCsvColumnMapping(order_ref="注文ID", item_id="商品コード", quantity="数量")

    service = ManualOrderService(db_session)
    result = await service.import_csv(shop.id, csv_text, mapping)

    assert result.created == 1
    assert result.errors == []
    order = (await db_session.execute(select(Order).where(Order.shop_id == shop.id))).scalars().one()
    assert order.total == 3000  # 単価1000 * 数量3


async def test_import_csv_groups_rows_with_same_order_ref_into_one_order(db_session: AsyncSession):
    shop = await _make_shop_with_item(db_session, "item-1")
    db_session.add(ManualItem(shop_id=shop.id, item_id="item-2", title="商品2", price=500, stock=100))
    await db_session.commit()
    csv_text = (
        "order_ref,item_id,quantity\n"
        "REF-1,item-1,1\n"
        "REF-1,item-2,2\n"
    )

    service = ManualOrderService(db_session)
    result = await service.import_csv(shop.id, csv_text)

    assert result.created == 1  # 2行だが同じorder_refなので1注文にまとまる
    order = (await db_session.execute(select(Order).where(Order.shop_id == shop.id))).scalars().one()
    order_items = (
        (await db_session.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars().all()
    )
    assert len(order_items) == 2


async def test_import_csv_reports_row_numbered_error_for_unknown_item(db_session: AsyncSession):
    shop = await _make_shop_with_item(db_session)
    csv_text = "order_ref,item_id,quantity\nREF-1,not-registered,1\n"

    service = ManualOrderService(db_session)
    result = await service.import_csv(shop.id, csv_text)

    assert result.created == 0
    assert len(result.errors) == 1
    assert "2行目" in result.errors[0]


async def test_import_csv_without_header_treats_first_row_as_data(db_session: AsyncSession):
    shop = await _make_shop_with_item(db_session)
    csv_text = "REF-1,item-1,5\n"  # ヘッダー無し。列1=order_ref, 列2=item_id, 列3=quantity
    mapping = ManualOrderCsvColumnMapping(order_ref="列1", item_id="列2", quantity="列3")

    service = ManualOrderService(db_session)
    result = await service.import_csv(shop.id, csv_text, mapping, has_header=False)

    assert result.created == 1
    assert result.errors == []


async def test_preview_csv_returns_columns_and_sample_rows(db_session: AsyncSession):
    shop = await _make_shop_with_item(db_session)
    csv_text = "order_ref,item_id,quantity\nREF-1,item-1,1\nREF-2,item-1,2\n"

    service = ManualOrderService(db_session)
    preview = service.preview_csv(csv_text)

    assert preview.columns == ["order_ref", "item_id", "quantity"]
    assert len(preview.sample_rows) == 2
    assert preview.sample_rows[0]["item_id"] == "item-1"
