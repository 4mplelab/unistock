from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import OrderItem, OrderItemOption
from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.services.assembly_service import AssemblyService
from app.services.bom_service import BomService


async def compute_cost_by_order_item(session: AsyncSession, order_item_ids: list[int], shop_id: int) -> dict[int, int]:
    """商品明細(order_item)ごとの原価を算出する。

    基本は実際に引当てた部品/中間品の内訳(order_part_reservations)×呼び出し時点の単価。
    ただし「バックフィル安全ルール」(初見で既に発送確定/キャンセル済みだった注文は、実在庫を
    誤って動かさないよう引当自体を作らない、order_ingestion_service._create_order参照)により
    引当記録が存在しない商品明細については、現在のBOM構成×現在の単価から見積もり原価を
    計算してフォールバックする(実引当・在庫操作は一切行わない、原価表示専用の参考値)。

    呼び出し元(発送確定時の確定計算、原価再計算機能)で計算結果をOrderItem.costへ書き込む。
    """
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

    part_cost = dict((await session.execute(select(Part.id, Part.unit_cost))).all())
    assembly_cost = await AssemblyService(session).compute_costs()

    cost_by_order_item: dict[int, int] = {}
    for order_item_id, part_id, assembly_id, qty in reservation_rows:
        unit_cost = part_cost.get(part_id, 0) if part_id is not None else assembly_cost.get(assembly_id, 0)
        cost_by_order_item[order_item_id] = cost_by_order_item.get(order_item_id, 0) + (unit_cost or 0) * qty

    missing_ids = [oid for oid in order_item_ids if oid not in cost_by_order_item]
    if missing_ids:
        cost_by_order_item.update(
            await _estimate_cost_from_bom(session, missing_ids, shop_id, part_cost, assembly_cost)
        )
    return cost_by_order_item


async def _estimate_cost_from_bom(
    session: AsyncSession,
    order_item_ids: list[int],
    shop_id: int,
    part_cost: dict[int, int],
    assembly_cost: dict[int, int],
) -> dict[int, int]:
    """引当記録が無い商品明細の原価を、BOM構成(条件・バリエーションの一致判定込み)×
    現在の単価から見積もる。判定ロジックはorder_ingestion_service._reserveの部品解決と
    揃えている(実引当は作らない点のみ異なる)。"""
    items = (await session.execute(select(OrderItem).where(OrderItem.id.in_(order_item_ids)))).scalars().all()
    if not items:
        return {}

    option_rows = (
        await session.execute(
            select(OrderItemOption.order_item_id, OrderItemOption.option_variation_id).where(
                OrderItemOption.order_item_id.in_(order_item_ids)
            )
        )
    ).all()
    options_by_item: dict[int, set[str]] = {}
    for oi_id, variation_id in option_rows:
        options_by_item.setdefault(oi_id, set()).add(variation_id)

    bom_service = BomService(session)
    bom_cache: dict[str, list] = {}
    cost_by_order_item: dict[int, int] = {}

    for oi in items:
        if oi.item_id not in bom_cache:
            bom_cache[oi.item_id] = await bom_service.get_bom_for_item(shop_id, oi.item_id)
        bom_lines = bom_cache[oi.item_id]
        if not bom_lines:
            continue

        selected_keys: set[tuple[str, str]] = {("option", vid) for vid in options_by_item.get(oi.id, set())}
        if oi.variation_id:
            selected_keys.add(("variation", oi.variation_id))

        applicable_lines = [
            line
            for line in bom_lines
            if all((c.selector_type, c.selector_id) in selected_keys for c in line.conditions)
        ]
        if not applicable_lines:
            continue

        unit_total = 0
        for line in applicable_lines:
            if line.part_id is not None:
                unit_total += (part_cost.get(line.part_id, 0) or 0) * line.quantity
            elif line.assembly_id is not None:
                unit_total += (assembly_cost.get(line.assembly_id, 0) or 0) * line.quantity
        cost_by_order_item[oi.id] = unit_total * oi.quantity

    return cost_by_order_item
