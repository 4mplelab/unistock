from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.services.assembly_service import AssemblyService


async def compute_cost_by_order_item(session: AsyncSession, order_item_ids: list[int]) -> dict[int, int]:
    """商品明細(order_item)ごとの原価を、実際に引当てた部品/中間品の内訳(order_part_reservations)
    ×呼び出し時点の単価から算出する。呼び出し元(発送確定時の確定計算、原価再計算機能)で
    計算結果をOrderItem.costへ書き込む用途、および原価再計算機能で使う。
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
    if not reservation_rows:
        return {}

    part_cost = dict((await session.execute(select(Part.id, Part.unit_cost))).all())
    assembly_cost = await AssemblyService(session).compute_costs()

    cost_by_order_item: dict[int, int] = {}
    for order_item_id, part_id, assembly_id, qty in reservation_rows:
        unit_cost = part_cost.get(part_id, 0) if part_id is not None else assembly_cost.get(assembly_id, 0)
        cost_by_order_item[order_item_id] = cost_by_order_item.get(order_item_id, 0) + (unit_cost or 0) * qty
    return cost_by_order_item
