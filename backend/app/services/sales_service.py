from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item_category import ItemCategory
from app.models.order import DispatchStatus, Order, OrderItem
from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.schemas.sales import (
    SalesSummaryCategoryProductRow,
    SalesSummaryCategoryRow,
    SalesSummaryPoint,
    SalesSummaryProductRow,
    SalesSummaryRead,
)
from app.services.assembly_service import AssemblyService

# 商品別ランキングの表示件数
PRODUCT_RANKING_LIMIT = 10

# カテゴリ未設定の商品をまとめるバケットのラベル
UNCATEGORIZED_LABEL = "未分類"


async def get_sales_summary(
    session: AsyncSession, days: int = 30, shop_id: int | None = None, date_basis: str = "dispatched"
) -> SalesSummaryRead:
    """発送確定(dispatched)した注文をもとに、直近days日間の売上・原価・粗利を集計する。

    date_basis="dispatched"(既定)では、日付は発送日(dispatched_at)基準とする(発送確定 =
    実際に売上が確定したタイミングとして扱う)。集計対象はどちらの基準でも常に発送確定済みの
    注文のみ(未発送・キャンセルの可能性がある注文の金額は、後で数字が変わってしまうため
    一切含めない)。

    date_basis="ordered"では、対象注文の母集団は変えず(発送確定済みのみ)、日付の集計キーだけ
    注文日(ordered_at)に切り替える。「実績としていつ確定したか」ではなく「需要がいつ発生したか」
    を見たい場合向け。この方式では、直近の日(その日の注文がまだ発送し終わっていない分がある日)
    は実際より少なく表示され、発送が進むにつれて後から数字が積み上がっていく(発送日基準では
    この遡りは起きない)点に注意。

    総売上・注文件数・平均注文単価はOrder.total(注文合計金額。送料・代引き手数料・
    割引を含み、キャンセル済み商品は除外済み)を使う。この列が無い注文(この機能追加より前に
    取り込まれ、かつ発送確定済みで以後totalが補われることのない注文)は、フォールバックとして
    商品明細のprice×quantityの合計で代用する。
    商品別ランキングはOrder.totalを商品ごとに配分できないため、商品明細のOrderItem.total
    (単価+オプション単価の合計を数量分。price×quantityと違いオプション追加料金も含む)を使う。
    この列も無い行(同様に機能追加より前の行)はprice×quantityにフォールバックする。
    いずれも送料・割引は含まれないため、総売上の内訳と厳密には一致しない参考値になる。

    原価は、注文取り込み時点の部品引当(_reserve)が既に計算しorder_part_reservationsに
    書き込み済みの「実際に消費した部品/中間品の内訳」を使う(BOMの条件判定をここで
    再実装しない)。中間品原価は現在の単価(部品原価合計+中間品自身の追加費用)を使うため、
    原価変動前の古い注文でも常に「現在の原価水準で計算した場合の粗利」を表す参考値になる。
    引当情報が無い行(この機能より前の注文、BOM未設定でスキップされた行等)は原価0円として扱う。
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    # 集計キーとなる日付列。母集団(発送確定済みのみ)はどちらの基準でも変えない
    date_column = Order.ordered_at if date_basis == "ordered" else Order.dispatched_at

    base_query = (
        select(
            Order.id,
            Order.shop_id,
            Order.total,
            date_column,
            OrderItem.id,
            OrderItem.item_id,
            OrderItem.title,
            OrderItem.quantity,
            OrderItem.price,
            OrderItem.total,
        )
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(
            Order.dispatch_status == DispatchStatus.DISPATCHED.value,
            Order.dispatched_at.is_not(None),
            date_column >= since,
            OrderItem.status != "cancelled",
        )
    )
    if shop_id is not None:
        base_query = base_query.where(Order.shop_id == shop_id)
    rows = (await session.execute(base_query)).all()

    order_item_ids = [row[4] for row in rows]
    cost_by_order_item = await _compute_cost_by_order_item(session, order_item_ids)
    categories_by_shop_item = await _fetch_categories_by_shop_item(
        session, {(row[1], row[5]) for row in rows}
    )

    orders: dict[int, dict] = {}
    revenue_by_product: dict[str, int] = {}
    cost_by_product: dict[str, int] = {}
    quantity_by_product: dict[str, int] = {}
    title_by_product: dict[str, str | None] = {}
    # カテゴリは(category_id, name)をキーにする。1商品が複数カテゴリに属する場合は
    # 属する各カテゴリにその商品の実績をそのまま計上する(合計が総売上を超えうる)
    revenue_by_category: dict[tuple[int | None, str], int] = {}
    quantity_by_category: dict[tuple[int | None, str], int] = {}
    # カテゴリ内の商品別内訳(カテゴリを選んで中の商品グラフを見る用途)
    revenue_by_category_product: dict[tuple[tuple[int | None, str], str], int] = {}
    quantity_by_category_product: dict[tuple[tuple[int | None, str], str], int] = {}

    for order_id, row_shop_id, order_total, bucket_date, order_item_id, item_id, title, quantity, price, item_total in rows:
        item_price_sum = (price or 0) * quantity
        order_entry = orders.setdefault(
            order_id, {"total": order_total, "bucket_date": bucket_date, "item_sum": 0, "cost_sum": 0}
        )
        order_entry["item_sum"] += item_price_sum
        item_cost = cost_by_order_item.get(order_item_id, 0)
        order_entry["cost_sum"] += item_cost

        item_revenue = item_total if item_total is not None else item_price_sum
        revenue_by_product[item_id] = revenue_by_product.get(item_id, 0) + item_revenue
        cost_by_product[item_id] = cost_by_product.get(item_id, 0) + item_cost
        quantity_by_product[item_id] = quantity_by_product.get(item_id, 0) + quantity
        title_by_product.setdefault(item_id, title)

        item_categories = categories_by_shop_item.get((row_shop_id, item_id)) or [(None, UNCATEGORIZED_LABEL)]
        for category_key in item_categories:
            revenue_by_category[category_key] = revenue_by_category.get(category_key, 0) + item_revenue
            quantity_by_category[category_key] = quantity_by_category.get(category_key, 0) + quantity
            product_key = (category_key, item_id)
            revenue_by_category_product[product_key] = revenue_by_category_product.get(product_key, 0) + item_revenue
            quantity_by_category_product[product_key] = (
                quantity_by_category_product.get(product_key, 0) + quantity
            )

    revenue_by_day: dict[str, int] = {}
    # 原価はOrder.totalのような注文単位の実測値が無いため、商品明細の原価をそのまま
    # 日別に合算する(総原価・商品別ランキングと同じ粒度で一貫させる)
    cost_by_day: dict[str, int] = {}
    orders_by_day: dict[str, set[int]] = {}
    total_revenue = 0
    for order_id, order_entry in orders.items():
        # BASEのtotalが取得できていればそれを正とし、無ければ商品明細の合計で代用する
        order_revenue = order_entry["total"] if order_entry["total"] is not None else order_entry["item_sum"]
        total_revenue += order_revenue

        day_key = order_entry["bucket_date"].date().isoformat()
        revenue_by_day[day_key] = revenue_by_day.get(day_key, 0) + order_revenue
        cost_by_day[day_key] = cost_by_day.get(day_key, 0) + order_entry["cost_sum"]
        orders_by_day.setdefault(day_key, set()).add(order_id)

    points = [
        SalesSummaryPoint(
            date=datetime.fromisoformat(day).date(),
            revenue=revenue,
            cost=cost_by_day.get(day, 0),
            gross_profit=revenue - cost_by_day.get(day, 0),
            order_count=len(orders_by_day[day]),
        )
        for day, revenue in sorted(revenue_by_day.items())
    ]

    products = [
        SalesSummaryProductRow(
            item_id=item_id,
            title=title_by_product.get(item_id),
            quantity=quantity_by_product[item_id],
            revenue=revenue,
            cost=cost_by_product.get(item_id, 0),
            gross_profit=revenue - cost_by_product.get(item_id, 0),
            gross_margin_rate=(revenue - cost_by_product.get(item_id, 0)) / revenue if revenue else 0.0,
        )
        for item_id, revenue in sorted(revenue_by_product.items(), key=lambda kv: kv[1], reverse=True)[
            :PRODUCT_RANKING_LIMIT
        ]
    ]

    products_by_category: dict[tuple[int | None, str], list[tuple[str, int]]] = {}
    for (category_key, item_id), product_revenue in revenue_by_category_product.items():
        products_by_category.setdefault(category_key, []).append((item_id, product_revenue))

    categories = [
        SalesSummaryCategoryRow(
            category_id=category_id,
            name=name,
            quantity=quantity_by_category[(category_id, name)],
            revenue=revenue,
            products=[
                SalesSummaryCategoryProductRow(
                    item_id=item_id,
                    title=title_by_product.get(item_id),
                    quantity=quantity_by_category_product[((category_id, name), item_id)],
                    revenue=product_revenue,
                )
                for item_id, product_revenue in sorted(
                    products_by_category.get((category_id, name), []), key=lambda kv: kv[1], reverse=True
                )[:PRODUCT_RANKING_LIMIT]
            ],
        )
        for (category_id, name), revenue in sorted(revenue_by_category.items(), key=lambda kv: kv[1], reverse=True)
    ]

    total_quantity = sum(quantity_by_product.values())
    order_count = len(orders)
    average_order_value = total_revenue / order_count if order_count else 0.0
    # 総原価は(総売上と違いOrder.totalのような注文単位の実測値が無いため)商品明細の
    # 原価をそのまま合算する。総売上の内訳(商品別ランキング)と同じ粒度で一貫させる
    total_cost = sum(cost_by_order_item.values())
    total_gross_profit = total_revenue - total_cost
    gross_margin_rate = total_gross_profit / total_revenue if total_revenue else 0.0

    return SalesSummaryRead(
        days=days,
        total_revenue=total_revenue,
        total_quantity=total_quantity,
        total_cost=total_cost,
        total_gross_profit=total_gross_profit,
        gross_margin_rate=gross_margin_rate,
        order_count=order_count,
        average_order_value=average_order_value,
        points=points,
        products=products,
        categories=categories,
    )


async def _fetch_categories_by_shop_item(
    session: AsyncSession, shop_item_pairs: set[tuple[int, str]]
) -> dict[tuple[int, str], list[tuple[int, str]]]:
    """(shop_id, item_id)ごとの所属カテゴリ(category_id, category_name)一覧を取得する。
    item_category_sync_schedulerが同期したitem_categoriesのキャッシュを参照するだけで、
    ここでBASEへ直接問い合わせることはしない。"""
    if not shop_item_pairs:
        return {}

    rows = (
        await session.execute(
            select(ItemCategory.shop_id, ItemCategory.item_id, ItemCategory.category_id, ItemCategory.category_name)
            .where(tuple_(ItemCategory.shop_id, ItemCategory.item_id).in_(shop_item_pairs))
        )
    ).all()

    result: dict[tuple[int, str], list[tuple[int, str]]] = {}
    for shop_id, item_id, category_id, category_name in rows:
        result.setdefault((shop_id, item_id), []).append((category_id, category_name))
    return result


async def _compute_cost_by_order_item(session: AsyncSession, order_item_ids: list[int]) -> dict[int, int]:
    """商品明細(order_item)ごとの原価を、実際に引当てた部品/中間品の内訳から算出する。"""
    if not order_item_ids:
        return {}

    reservation_rows = (
        await session.execute(
            select(
                OrderPartReservation.order_item_id,
                OrderPartReservation.part_id,
                OrderPartReservation.assembly_id,
                func.sum(OrderPartReservation.quantity),
            )
            .where(OrderPartReservation.order_item_id.in_(order_item_ids))
            .group_by(
                OrderPartReservation.order_item_id,
                OrderPartReservation.part_id,
                OrderPartReservation.assembly_id,
            )
        )
    ).all()
    if not reservation_rows:
        return {}

    part_cost = dict((await session.execute(select(Part.id, Part.unit_cost))).all())
    assembly_cost = await AssemblyService(session).compute_costs()

    cost_by_order_item: dict[int, int] = {}
    for order_item_id, part_id, assembly_id, qty in reservation_rows:
        unit_cost = part_cost.get(part_id, 0) if part_id is not None else assembly_cost.get(assembly_id, 0)
        cost_by_order_item[order_item_id] = cost_by_order_item.get(order_item_id, 0) + (unit_cost or 0) * qty
    return cost_by_order_item
