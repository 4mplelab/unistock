from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.manual_order_import_profile import ManualOrderImportProfileCreate, ManualOrderImportProfileRead
from app.services.auth_service import require_auth
from app.services.manual_order_import_profile_service import (
    ManualOrderImportProfileAlreadyExistsError,
    ManualOrderImportProfileNotFoundError,
    ManualOrderImportProfileService,
)

router = APIRouter(
    prefix="/api/shops/{shop_id}/manual-order-import-profiles",
    tags=["manual-order-import-profiles"],
    dependencies=[Depends(require_auth)],
)


@router.get("", response_model=list[ManualOrderImportProfileRead])
async def list_manual_order_import_profiles(
    shop_id: int, session: AsyncSession = Depends(get_db)
) -> list[ManualOrderImportProfileRead]:
    service = ManualOrderImportProfileService(session)
    return await service.list_by_shop(shop_id)


@router.post("", response_model=ManualOrderImportProfileRead, status_code=201)
async def create_manual_order_import_profile(
    shop_id: int, body: ManualOrderImportProfileCreate, session: AsyncSession = Depends(get_db)
) -> ManualOrderImportProfileRead:
    service = ManualOrderImportProfileService(session)
    try:
        return await service.create(shop_id, body)
    except ManualOrderImportProfileAlreadyExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.delete("/{profile_id}", status_code=204)
async def delete_manual_order_import_profile(
    shop_id: int, profile_id: int, session: AsyncSession = Depends(get_db)
) -> None:
    service = ManualOrderImportProfileService(session)
    try:
        await service.delete(shop_id, profile_id)
    except ManualOrderImportProfileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
