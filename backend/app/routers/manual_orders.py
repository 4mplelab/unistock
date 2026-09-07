from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.order import Order
from app.routers.orders import _load_items_map, _load_options_map, _to_read
from app.schemas.manual_order import ManualOrderCreate, ManualOrderCsvPreview, ManualOrderImportResult
from app.schemas.manual_order_import_profile import ManualOrderCsvColumnMapping
from app.schemas.order import OrderRead
from app.services.auth_service import require_auth
from app.services.manual_order_service import ManualOrderService

router = APIRouter(
    prefix="/api/shops/{shop_id}/manual-orders", tags=["manual-orders"], dependencies=[Depends(require_auth)]
)


@router.post("", response_model=OrderRead, status_code=201)
async def create_manual_order(
    shop_id: int, body: ManualOrderCreate, session: AsyncSession = Depends(get_db)
) -> OrderRead:
    service = ManualOrderService(session)
    try:
        order = await service.create_order(shop_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # ingest_manual_order内(_reserve等)の複数回のcommitでorderの属性がexpireされているため、
    # _to_readでの同期アクセス前に明示的にリフレッシュする
    await session.refresh(order)
    items_map = await _load_items_map(session, [order.id])
    items = items_map.get(order.id, [])
    options_map = await _load_options_map(session, [i.id for i in items])
    return _to_read(order, items, options_map)


@router.patch("/{order_id}", response_model=OrderRead)
async def update_manual_order(
    shop_id: int, order_id: int, body: ManualOrderCreate, session: AsyncSession = Depends(get_db)
) -> OrderRead:
    order = await session.get(Order, order_id)
    if order is None or order.shop_id != shop_id:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")

    service = ManualOrderService(session)
    try:
        order = await service.update_order(shop_id, order, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    await session.refresh(order)
    items_map = await _load_items_map(session, [order.id])
    items = items_map.get(order.id, [])
    options_map = await _load_options_map(session, [i.id for i in items])
    return _to_read(order, items, options_map)


@router.post("/import/preview", response_model=ManualOrderCsvPreview)
async def preview_manual_orders_import(
    shop_id: int,
    file: UploadFile = File(...),
    has_header: bool = Form(True),
    session: AsyncSession = Depends(get_db),
) -> ManualOrderCsvPreview:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"CSVの文字コードが不正です: {e}") from e

    service = ManualOrderService(session)
    return service.preview_csv(text, has_header)


@router.post("/import", response_model=ManualOrderImportResult)
async def import_manual_orders(
    shop_id: int,
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    has_header: bool = Form(True),
    session: AsyncSession = Depends(get_db),
) -> ManualOrderImportResult:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"CSVの文字コードが不正です: {e}") from e

    parsed_mapping: ManualOrderCsvColumnMapping | None = None
    if mapping:
        try:
            parsed_mapping = ManualOrderCsvColumnMapping.model_validate_json(mapping)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"列マッピングの形式が不正です: {e}") from e

    service = ManualOrderService(session)
    return await service.import_csv(shop_id, text, parsed_mapping, has_header)
