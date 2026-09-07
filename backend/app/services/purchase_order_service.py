from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.part import Part
from app.models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from app.schemas.purchase_order import PurchaseOrderCreate
from app.services.stock_movement_service import record_part_movement


class PurchaseOrderNotFoundError(Exception):
    pass


class PurchaseOrderNotOpenError(Exception):
    pass


class PurchaseOrderService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_orders(
        self,
        status: str | None = None,
        part_name: str | None = None,
        highlight: int | None = None,
        shop_id: int | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[tuple[PurchaseOrder, str]], int, int]:
        """発注一覧。highlight(発注id)が指定された場合、そのクライアント指定のoffsetは
        無視し、その発注が含まれるページを自動的に計算して返す(在庫変動履歴から
        「この発注を見る」で遷移してきた場合に、クライアント側で全件検索する必要をなくす)。
        shop_idを渡すとそのショップの発注のみに絞り込む。
        """
        stmt = select(PurchaseOrder, Part.name).join(Part, PurchaseOrder.part_id == Part.id)
        if status is not None:
            stmt = stmt.where(PurchaseOrder.status == status)
        if part_name:
            stmt = stmt.where(Part.name.ilike(f"%{part_name}%"))
        if shop_id is not None:
            stmt = stmt.where(PurchaseOrder.shop_id == shop_id)

        count_result = await self._session.execute(select(func.count()).select_from(stmt.subquery()))
        total = count_result.scalar_one()

        if highlight:
            target = await self._session.get(PurchaseOrder, highlight)
            if target is not None:
                preceding_stmt = stmt.where(PurchaseOrder.ordered_at > target.ordered_at)
                preceding = (
                    await self._session.execute(select(func.count()).select_from(preceding_stmt.subquery()))
                ).scalar_one()
                offset = (preceding // limit) * limit if limit > 0 else 0

        stmt = stmt.order_by(PurchaseOrder.ordered_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        page = offset // limit + 1 if limit > 0 else 1
        return [(po, name) for po, name in result.all()], total, page

    async def create_order(self, data: PurchaseOrderCreate) -> PurchaseOrder:
        order = PurchaseOrder(
            part_id=data.part_id,
            shop_id=data.shop_id,
            quantity=data.quantity,
            note=data.note,
            expected_delivery_date=data.expected_delivery_date,
            order_url=data.order_url,
            status=PurchaseOrderStatus.ORDERED.value,
        )
        self._session.add(order)
        await self._session.commit()
        await self._session.refresh(order)
        return order

    async def _get_open_order(self, order_id: int) -> PurchaseOrder:
        order = await self._session.get(PurchaseOrder, order_id)
        if order is None:
            raise PurchaseOrderNotFoundError(f"purchase_order {order_id} not found")
        if order.status != PurchaseOrderStatus.ORDERED.value:
            raise PurchaseOrderNotOpenError(
                f"purchase_order {order_id} は ordered 以外のため処理できません(status={order.status})"
            )
        return order

    async def _get_received_order(self, order_id: int) -> PurchaseOrder:
        order = await self._session.get(PurchaseOrder, order_id)
        if order is None:
            raise PurchaseOrderNotFoundError(f"purchase_order {order_id} not found")
        if order.status != PurchaseOrderStatus.RECEIVED.value:
            raise PurchaseOrderNotOpenError(
                f"purchase_order {order_id} は received 以外のため入荷取消しできません(status={order.status})"
            )
        return order

    async def receive_order(self, order_id: int, received_at: datetime | None = None) -> PurchaseOrder:
        order = await self._get_open_order(order_id)

        part_result = await self._session.execute(
            select(Part).where(Part.id == order.part_id).with_for_update()
        )
        part = part_result.scalars().one()
        part.stock += order.quantity
        await record_part_movement(
            self._session,
            order.part_id,
            order.quantity,
            reason="purchase_order_received",
            purchase_order_id=order.id,
            shop_id=order.shop_id,
        )

        order.status = PurchaseOrderStatus.RECEIVED.value
        order.received_at = received_at or datetime.now(timezone.utc)
        await self._session.commit()
        await self._session.refresh(order)
        return order

    async def undo_receive_order(self, order_id: int) -> PurchaseOrder:
        """誤って入荷処理してしまった場合の取消し。在庫を入荷分だけ差し戻し、
        発注中の状態に戻す。差し戻し後の在庫がマイナスになっても許容する
        (既に他の用途で消費されていた場合はアラート側で表面化させる方針)"""
        order = await self._get_received_order(order_id)

        part_result = await self._session.execute(
            select(Part).where(Part.id == order.part_id).with_for_update()
        )
        part = part_result.scalars().one()
        part.stock -= order.quantity
        await record_part_movement(
            self._session,
            order.part_id,
            -order.quantity,
            reason="purchase_order_receive_undone",
            purchase_order_id=order.id,
            shop_id=order.shop_id,
        )

        order.status = PurchaseOrderStatus.ORDERED.value
        order.received_at = None
        await self._session.commit()
        await self._session.refresh(order)
        return order

    async def cancel_order(self, order_id: int) -> PurchaseOrder:
        order = await self._get_open_order(order_id)
        order.status = PurchaseOrderStatus.CANCELLED.value
        await self._session.commit()
        await self._session.refresh(order)
        return order

    async def update_order_url(self, order_id: int, order_url: str | None) -> PurchaseOrder:
        order = await self._session.get(PurchaseOrder, order_id)
        if order is None:
            raise PurchaseOrderNotFoundError(f"purchase_order {order_id} not found")
        order.order_url = order_url
        await self._session.commit()
        await self._session.refresh(order)
        return order

    async def list_reorder_needed(self) -> list[tuple[Part, bool]]:
        result = await self._session.execute(
            select(Part).where(
                Part.purchasable.is_(True),
                Part.reorder_threshold.is_not(None),
                (Part.stock - Part.reserved) < Part.reorder_threshold,
            )
        )
        parts = list(result.scalars().all())
        if not parts:
            return []

        part_ids = [p.id for p in parts]
        open_result = await self._session.execute(
            select(PurchaseOrder.part_id)
            .where(
                PurchaseOrder.part_id.in_(part_ids),
                PurchaseOrder.status == PurchaseOrderStatus.ORDERED.value,
            )
            .distinct()
        )
        open_part_ids = set(open_result.scalars().all())
        return [(p, p.id in open_part_ids) for p in parts]

    async def list_overdue(self) -> list[tuple[PurchaseOrder, str]]:
        """未入荷(status=ordered)のまま予定納期(expected_delivery_date)を過ぎた発注を返す。

        expected_delivery_date自体は元々表示専用のフィールドだった(自動で何かする
        わけではない)ため、この検知ロジックは通知機能のために新規追加したもの
        (list_reorder_neededと違い、これまで再利用できる既存クエリが無かった)。
        """
        result = await self._session.execute(
            select(PurchaseOrder, Part.name)
            .join(Part, PurchaseOrder.part_id == Part.id)
            .where(
                PurchaseOrder.status == PurchaseOrderStatus.ORDERED.value,
                PurchaseOrder.expected_delivery_date.is_not(None),
                PurchaseOrder.expected_delivery_date < datetime.now(timezone.utc).date(),
            )
        )
        return [(po, name) for po, name in result.all()]

    async def list_lead_times(self) -> list[int]:
        """入荷済み発注について、発注日から入荷日までの経過日数(四捨五入)を実績値として返す。"""
        result = await self._session.execute(
            select(PurchaseOrder.ordered_at, PurchaseOrder.received_at).where(
                PurchaseOrder.status == PurchaseOrderStatus.RECEIVED.value,
                PurchaseOrder.received_at.is_not(None),
            )
        )
        lead_times = []
        for ordered_at, received_at in result.all():
            days = round((received_at - ordered_at).total_seconds() / 86400)
            lead_times.append(max(0, days))
        return lead_times
