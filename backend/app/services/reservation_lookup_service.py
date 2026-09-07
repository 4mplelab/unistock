from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.order import Order
from app.models.order_reservation import OrderPartReservation


@dataclass
class ReservingOrder:
    """ある部品/中間品を現在引当中(未消費・未解放)の注文1件分の集計。"""

    order_id: int
    unique_key: str
    dispatch_status: str
    ordered_at: datetime
    quantity: int


async def list_reserving_orders_for_part(session: AsyncSession, part_id: int) -> list[ReservingOrder]:
    return await _list_reserving_orders(session, OrderPartReservation.part_id == part_id)


async def list_reserving_orders_for_assembly(session: AsyncSession, assembly_id: int) -> list[ReservingOrder]:
    return await _list_reserving_orders(session, OrderPartReservation.assembly_id == assembly_id)


async def _list_reserving_orders(
    session: AsyncSession, component_filter: ColumnElement[bool]
) -> list[ReservingOrder]:
    # applied=Falseの行だけがpart.reserved/assembly.reservedとして現在も保持されている引当
    # (applied=Trueは既に消費/解放済みで、もう在庫を押さえていない)
    stmt = (
        select(
            Order.id,
            Order.unique_key,
            Order.dispatch_status,
            Order.ordered_at,
            func.sum(OrderPartReservation.quantity),
        )
        .join(Order, Order.id == OrderPartReservation.order_id)
        .where(component_filter, OrderPartReservation.applied.is_(False))
        .group_by(Order.id, Order.unique_key, Order.dispatch_status, Order.ordered_at)
        .order_by(Order.ordered_at)
    )
    result = await session.execute(stmt)
    return [
        ReservingOrder(
            order_id=order_id,
            unique_key=unique_key,
            dispatch_status=dispatch_status,
            ordered_at=ordered_at,
            quantity=quantity,
        )
        for order_id, unique_key, dispatch_status, ordered_at, quantity in result.all()
    ]
