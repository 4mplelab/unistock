from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.manual_item import ManualItemConsumeCreate, ManualItemCreate, ManualItemRead, ManualItemUpdate
from app.services.assembly_service import InsufficientMaterialStockError
from app.services.auth_service import require_auth
from app.services.manual_item_service import (
    ManualItemAlreadyExistsError,
    ManualItemNotFoundError,
    ManualItemService,
)

router = APIRouter(
    prefix="/api/shops/{shop_id}/manual-items", tags=["manual-items"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[ManualItemRead])
async def list_manual_items(shop_id: int, session: AsyncSession = Depends(get_db)) -> list[ManualItemRead]:
    service = ManualItemService(session)
    items = await service.list_items(shop_id)
    return [ManualItemRead.model_validate(i) for i in items]


@router.post("", response_model=ManualItemRead, status_code=201)
async def create_manual_item(
    shop_id: int, body: ManualItemCreate, session: AsyncSession = Depends(get_db)
) -> ManualItemRead:
    service = ManualItemService(session)
    try:
        item = await service.create_item(shop_id, body)
    except ManualItemAlreadyExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ManualItemRead.model_validate(item)


@router.patch("/{item_id}", response_model=ManualItemRead)
async def update_manual_item(
    shop_id: int, item_id: str, body: ManualItemUpdate, session: AsyncSession = Depends(get_db)
) -> ManualItemRead:
    service = ManualItemService(session)
    try:
        item = await service.update_item(shop_id, item_id, body)
    except ManualItemNotFoundError as e:
        raise HTTPException(status_code=404, detail="商品が見つかりません") from e
    return ManualItemRead.model_validate(item)


@router.delete("/{item_id}", status_code=204)
async def delete_manual_item(shop_id: int, item_id: str, session: AsyncSession = Depends(get_db)) -> None:
    service = ManualItemService(session)
    try:
        await service.delete_item(shop_id, item_id)
    except ManualItemNotFoundError as e:
        raise HTTPException(status_code=404, detail="商品が見つかりません") from e


@router.post("/{item_id}/consume", response_model=ManualItemRead)
async def consume_manual_item(
    shop_id: int, item_id: str, body: ManualItemConsumeCreate, session: AsyncSession = Depends(get_db)
) -> ManualItemRead:
    service = ManualItemService(session)
    try:
        item = await service.consume_stock(shop_id, item_id, body.quantity, body.variation_id, body.note)
    except ManualItemNotFoundError as e:
        raise HTTPException(status_code=404, detail="商品が見つかりません") from e
    except InsufficientMaterialStockError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ManualItemRead.model_validate(item)
