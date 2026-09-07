from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.order_reservation import ReservingOrderRead
from app.schemas.part import PartAddStock, PartCreate, PartImportResult, PartRead, PartUpdate
from app.schemas.stock_movement import StockMovementListRead
from app.services.auth_service import require_auth
from app.services.part_service import PartInUseError, PartNotFoundError, PartService
from app.services.reservation_lookup_service import list_reserving_orders_for_part
from app.services.stock_movement_service import list_movements, page_to_read

router = APIRouter(prefix="/api/parts", tags=["parts"], dependencies=[Depends(require_auth)])


@router.get("", response_model=list[PartRead])
async def list_parts(session: AsyncSession = Depends(get_db)) -> list[PartRead]:
    service = PartService(session)
    parts = await service.list_parts()
    ordered_qty = await service.get_ordered_quantities([p.id for p in parts])
    return [
        PartRead.model_validate(p).model_copy(update={"ordered_quantity": ordered_qty.get(p.id, 0)})
        for p in parts
    ]


@router.post("", response_model=PartRead, status_code=201)
async def create_part(body: PartCreate, session: AsyncSession = Depends(get_db)) -> PartRead:
    service = PartService(session)
    part = await service.create_part(body)
    return PartRead.model_validate(part)


@router.get("/export")
async def export_parts(session: AsyncSession = Depends(get_db)) -> Response:
    service = PartService(session)
    csv_content = await service.export_csv()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=parts.csv"},
    )


@router.post("/import", response_model=PartImportResult)
async def import_parts(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_db)
) -> PartImportResult:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"CSVの文字コードが不正です: {e}") from e

    service = PartService(session)
    return await service.import_csv(text)


@router.get("/{part_id}", response_model=PartRead)
async def get_part(part_id: int, session: AsyncSession = Depends(get_db)) -> PartRead:
    service = PartService(session)
    try:
        part = await service.get_part(part_id)
    except PartNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    ordered_qty = await service.get_ordered_quantities([part_id])
    return PartRead.model_validate(part).model_copy(update={"ordered_quantity": ordered_qty.get(part_id, 0)})


@router.patch("/{part_id}", response_model=PartRead)
async def update_part(
    part_id: int, body: PartUpdate, session: AsyncSession = Depends(get_db)
) -> PartRead:
    service = PartService(session)
    try:
        part = await service.update_part(part_id, body)
    except PartNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return PartRead.model_validate(part)


@router.post("/{part_id}/add-stock", response_model=PartRead)
async def add_part_stock(
    part_id: int, body: PartAddStock, session: AsyncSession = Depends(get_db)
) -> PartRead:
    service = PartService(session)
    try:
        part = await service.add_stock(part_id, body.quantity, body.note)
    except PartNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return PartRead.model_validate(part)


@router.get("/{part_id}/reservations", response_model=list[ReservingOrderRead])
async def list_part_reservations(
    part_id: int, session: AsyncSession = Depends(get_db)
) -> list[ReservingOrderRead]:
    orders = await list_reserving_orders_for_part(session, part_id)
    return [ReservingOrderRead.model_validate(o.__dict__) for o in orders]


@router.get("/{part_id}/stock-movements", response_model=StockMovementListRead)
async def list_part_stock_movements(
    part_id: int, limit: int = 20, offset: int = 0, session: AsyncSession = Depends(get_db)
) -> StockMovementListRead:
    page = await list_movements(session, part_id=part_id, limit=limit, offset=offset)
    return page_to_read(page)


@router.delete("/{part_id}", status_code=204)
async def delete_part(part_id: int, session: AsyncSession = Depends(get_db)) -> None:
    service = PartService(session)
    try:
        await service.delete_part(part_id)
    except PartNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PartInUseError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
