from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.bom_product_setting import BomProductSetting
from app.models.order import Order, OrderItem, OrderItemOption
from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.schemas.order import OrderItemOptionRead
from app.schemas.order_summary import (
    OrderSummaryItemRead,
    OrderSummaryRead,
    OrderSummaryRow,
    PickListEntryRead,
)


async def get_order_summary(
    session: AsyncSession,
    dispatch_status: str = "ordered",
    unique_keys: list[str] | None = None,
    shop_id: int | None = None,
) -> OrderSummaryRead:
    """注文と、その注文が消費する部品・中間品の一覧を返す。

    「中間品在庫を優先消費し、不足分は構成部品まで(多段階層も)自動的に遡って分解する」
    というロジックは、注文取り込み時の部品引当(_resolve_component)が既に計算し
    order_part_reservationsに書き込み済みのため、ここでは新たに分解計算をせず、
    その結果を部品/中間品ごとに集計して読み出すだけでよい。

    dispatch_statusは既定で"ordered"(未対応)のみに絞る(ピッキング画面の用途)。
    "all"を渡すと状態を問わず全件を対象にする。unique_keysを渡した場合はdispatch_status
    を無視し、その注文番号の集合だけを対象にする(注文一覧でチェックボックス選択して
    PDF出力する用途)。shop_idを渡すとそのショップの注文のみに絞り込む。
    """
    # 注文一覧(order_service.list_orders)と同じ並び順(新しい順)に揃える
    query = select(Order).order_by(Order.ordered_at.desc())
    if unique_keys is not None:
        query = query.where(Order.unique_key.in_(unique_keys))
    elif dispatch_status != "all":
        query = query.where(Order.dispatch_status == dispatch_status)
    if shop_id is not None:
        query = query.where(Order.shop_id == shop_id)
    orders_result = await session.execute(query)
    orders = list(orders_result.scalars().all())
    if not orders:
        return OrderSummaryRead(orders=[], aggregate=[])

    order_ids = [o.id for o in orders]

    # order_byが無いとチェックのたびの再取得(picked更新→invalidateQueries)で商品の
    # 並びがDBの実行計画次第でぶれてしまう(ORDER BY無しのSELECTは順序を保証しない)ため、
    # 作成順(=注文明細として本来並んでいた順)に固定する
    items_result = await session.execute(
        select(OrderItem).where(OrderItem.order_id.in_(order_ids)).order_by(OrderItem.id.asc())
    )
    items = list(items_result.scalars().all())
    items_by_order: dict[int, list[OrderItem]] = {}
    for item in items:
        items_by_order.setdefault(item.order_id, []).append(item)

    item_ids = [i.id for i in items]
    options_map: dict[int, list[OrderItemOption]] = {}
    if item_ids:
        options_result = await session.execute(
            select(OrderItemOption)
            .where(OrderItemOption.order_item_id.in_(item_ids))
            .order_by(OrderItemOption.sort_order.asc().nulls_last(), OrderItemOption.id.asc())
        )
        for opt in options_result.scalars().all():
            options_map.setdefault(opt.order_item_id, []).append(opt)

    # order_item_id込みで集計する(商品ごとのpick_list用)。全体集計(aggregate)は
    # これをorder_item_idを無視して合算するだけで済むため、クエリは1回でよい
    reservations_result = await session.execute(
        select(
            OrderPartReservation.order_item_id,
            OrderPartReservation.part_id,
            OrderPartReservation.assembly_id,
            func.sum(OrderPartReservation.quantity),
        )
        .where(OrderPartReservation.order_id.in_(order_ids))
        .group_by(
            OrderPartReservation.order_item_id, OrderPartReservation.part_id, OrderPartReservation.assembly_id
        )
    )
    reservation_rows = reservations_result.all()

    part_ids = {r[1] for r in reservation_rows if r[1] is not None}
    assembly_ids = {r[2] for r in reservation_rows if r[2] is not None}
    parts_map: dict[int, Part] = {}
    if part_ids:
        parts_result = await session.execute(select(Part).where(Part.id.in_(part_ids)))
        parts_map = {p.id: p for p in parts_result.scalars().all()}
    assemblies_map: dict[int, Assembly] = {}
    if assembly_ids:
        assemblies_result = await session.execute(select(Assembly).where(Assembly.id.in_(assembly_ids)))
        assemblies_map = {a.id: a for a in assemblies_result.scalars().all()}

    # order_item_idがNULLの行(マイグレーション前に作成された過去分の引当)はどの商品由来か
    # 特定できないため、商品ごとのpick_listには含めない(全体集計には引き続き含まれる)
    pick_lists_by_item: dict[int, list[PickListEntryRead]] = {}
    aggregate_map: dict[tuple[str, int], PickListEntryRead] = {}
    for order_item_id, part_id, assembly_id, qty in reservation_rows:
        if part_id is not None:
            part = parts_map[part_id]
            component_type, component_id, name = "part", part_id, part.name
            group, colors = part.group, part.colors
        else:
            component_type, component_id, name = "assembly", assembly_id, assemblies_map[assembly_id].name
            group, colors = None, None

        if order_item_id is not None:
            pick_lists_by_item.setdefault(order_item_id, []).append(
                PickListEntryRead(
                    component_type=component_type, id=component_id, name=name, quantity=qty, group=group, colors=colors
                )
            )

        agg_key = (component_type, component_id)
        if agg_key in aggregate_map:
            aggregate_map[agg_key].quantity += qty
        else:
            aggregate_map[agg_key] = PickListEntryRead(
                component_type=component_type, id=component_id, name=name, quantity=qty, group=group, colors=colors
            )

    order_by_id = {o.id: o for o in orders}
    # item_idはショップごとに割り振られるため、shop_idと組み合わせないと別ショップの同じ
    # item_id文字列に誤って一致しうる
    shop_item_pairs = {(order_by_id[i.order_id].shop_id, i.item_id) for i in items}
    matrix_layout_map: dict[tuple[int, str], bool] = {}
    if shop_item_pairs:
        settings_result = await session.execute(
            select(BomProductSetting).where(
                tuple_(BomProductSetting.shop_id, BomProductSetting.item_id).in_(shop_item_pairs)
            )
        )
        matrix_layout_map = {
            (s.shop_id, s.item_id): s.matrix_layout for s in settings_result.scalars().all()
        }

    rows: list[OrderSummaryRow] = []
    for order in orders:
        order_items = items_by_order.get(order.id, [])
        rows.append(
            OrderSummaryRow(
                id=order.id,
                shop_id=order.shop_id,
                unique_key=order.unique_key,
                ordered_at=order.ordered_at,
                last_name=order.last_name,
                prefecture=order.prefecture,
                address=order.address,
                first_name=order.first_name,
                items=[
                    OrderSummaryItemRead(
                        id=i.id,
                        item_id=i.item_id,
                        title=i.title,
                        quantity=i.quantity,
                        variation=i.variation,
                        status=i.status,
                        options=[OrderItemOptionRead.model_validate(o) for o in options_map.get(i.id, [])],
                        reservation_applied=i.reservation_applied,
                        picked=i.picked,
                        pick_list=sorted(
                            pick_lists_by_item.get(i.id, []), key=lambda e: (e.component_type, e.name)
                        ),
                        matrix_layout=matrix_layout_map.get((order.shop_id, i.item_id), False),
                    )
                    for i in order_items
                ],
                has_unresolved_items=any(not i.reservation_applied for i in order_items),
            )
        )

    aggregate = sorted(aggregate_map.values(), key=lambda e: (e.component_type, e.name))
    return OrderSummaryRead(orders=rows, aggregate=aggregate)
