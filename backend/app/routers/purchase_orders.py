from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.purchase_order import PurchaseOrder
from app.schemas.purchase_order import (
    LeadTimeSummaryRead,
    PurchaseOrderCreate,
    PurchaseOrderListRead,
    PurchaseOrderReceiveInput,
    PurchaseOrderRead,
    PurchaseOrderUrlUpdate,
    ReorderNeededRead,
)
from app.services.auth_service import require_auth
from app.services.part_service import PartNotFoundError, PartService
from app.services.purchase_order_service import (
    PurchaseOrderNotFoundError,
    PurchaseOrderNotOpenError,
    PurchaseOrderService,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"], dependencies=[Depends(require_auth)])


def _to_read(order: PurchaseOrder, part_name: str) -> PurchaseOrderRead:
    return PurchaseOrderRead(
        id=order.id,
        part_id=order.part_id,
        shop_id=order.shop_id,
        part_name=part_name,
        quantity=order.quantity,
        status=order.status,
        ordered_at=order.ordered_at,
        received_at=order.received_at,
        expected_delivery_date=order.expected_delivery_date,
        note=order.note,
        order_url=order.order_url,
        created_at=order.created_at,
    )


@router.get("", response_model=PurchaseOrderListRead)
async def list_orders(
    status: str | None = None,
    part_name: str | None = None,
    highlight: int | None = None,
    shop_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_db),
) -> PurchaseOrderListRead:
    service = PurchaseOrderService(session)
    rows, total, page = await service.list_orders(
        status, part_name, highlight=highlight, shop_id=shop_id, limit=limit, offset=offset
    )
    return PurchaseOrderListRead(items=[_to_read(po, name) for po, name in rows], total=total, page=page)


@router.get("/reorder-needed", response_model=list[ReorderNeededRead])
async def reorder_needed(session: AsyncSession = Depends(get_db)) -> list[ReorderNeededRead]:
    service = PurchaseOrderService(session)
    rows = await service.list_reorder_needed()
    return [
        ReorderNeededRead(
            id=part.id,
            name=part.name,
            sku=part.sku,
            stock=part.stock,
            reserved=part.reserved,
            available=part.stock - part.reserved,
            reorder_threshold=part.reorder_threshold,
            purchase_url=part.purchase_url,
            has_open_order=has_open_order,
            group=part.group,
            colors=part.colors,
            tags=part.tags,
        )
        for part, has_open_order in rows
    ]


@router.get("/lead-time-summary", response_model=LeadTimeSummaryRead)
async def lead_time_summary(session: AsyncSession = Depends(get_db)) -> LeadTimeSummaryRead:
    service = PurchaseOrderService(session)
    lead_times = await service.list_lead_times()
    return LeadTimeSummaryRead(lead_times_days=lead_times)


@router.post("", response_model=PurchaseOrderRead, status_code=201)
async def create_order(
    body: PurchaseOrderCreate, session: AsyncSession = Depends(get_db)
) -> PurchaseOrderRead:
    part_service = PartService(session)
    try:
        part = await part_service.get_part(body.part_id)
    except PartNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    service = PurchaseOrderService(session)
    order = await service.create_order(body)
    return _to_read(order, part.name)


@router.post("/{order_id}/receive", response_model=PurchaseOrderRead)
async def receive_order(
    order_id: int, body: PurchaseOrderReceiveInput | None = None, session: AsyncSession = Depends(get_db)
) -> PurchaseOrderRead:
    service = PurchaseOrderService(session)
    try:
        order = await service.receive_order(order_id, received_at=body.received_at if body else None)
    except PurchaseOrderNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PurchaseOrderNotOpenError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    part_service = PartService(session)
    part = await part_service.get_part(order.part_id)
    return _to_read(order, part.name)


@router.post("/{order_id}/undo-receive", response_model=PurchaseOrderRead)
async def undo_receive_order(order_id: int, session: AsyncSession = Depends(get_db)) -> PurchaseOrderRead:
    service = PurchaseOrderService(session)
    try:
        order = await service.undo_receive_order(order_id)
    except PurchaseOrderNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PurchaseOrderNotOpenError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    part_service = PartService(session)
    part = await part_service.get_part(order.part_id)
    return _to_read(order, part.name)


@router.post("/{order_id}/cancel", response_model=PurchaseOrderRead)
async def cancel_order(order_id: int, session: AsyncSession = Depends(get_db)) -> PurchaseOrderRead:
    service = PurchaseOrderService(session)
    try:
        order = await service.cancel_order(order_id)
    except PurchaseOrderNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PurchaseOrderNotOpenError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    part_service = PartService(session)
    part = await part_service.get_part(order.part_id)
    return _to_read(order, part.name)


@router.patch("/{order_id}/url", response_model=PurchaseOrderRead)
async def update_order_url(
    order_id: int, body: PurchaseOrderUrlUpdate, session: AsyncSession = Depends(get_db)
) -> PurchaseOrderRead:
    service = PurchaseOrderService(session)
    try:
        order = await service.update_order_url(order_id, body.order_url)
    except PurchaseOrderNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    part_service = PartService(session)
    part = await part_service.get_part(order.part_id)
    return _to_read(order, part.name)
