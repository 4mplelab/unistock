from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.providers.base import ECAuthError
from app.providers.factory import build_provider
from app.schemas.stock_schedule import (
    StockScheduleCreate,
    StockScheduleListRead,
    StockScheduleRead,
    StockScheduleUpdate,
)
from app.services.auth_service import require_auth
from app.services.schedule_service import (
    DuplicatePendingScheduleError,
    ScheduleNotCancellableError,
    ScheduleNotEditableError,
    ScheduleNotFoundError,
    ScheduleService,
)
from app.services.shop_service import ShopNotFoundError, ShopService

router = APIRouter(prefix="/api/schedules", tags=["schedules"], dependencies=[Depends(require_auth)])


@router.get("", response_model=StockScheduleListRead)
async def list_schedules(
    limit: int = 20,
    offset: int = 0,
    shop_id: int | None = None,
    status: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> StockScheduleListRead:
    service = ScheduleService(session)
    schedules, total = await service.list_schedules(limit=limit, offset=offset, shop_id=shop_id, status=status)
    return StockScheduleListRead(
        items=[StockScheduleRead.model_validate(s) for s in schedules], total=total
    )


@router.post("", response_model=StockScheduleRead, status_code=201)
async def create_schedule(
    body: StockScheduleCreate, session: AsyncSession = Depends(get_db)
) -> StockScheduleRead:
    try:
        shop = await ShopService(session).get_shop(body.shop_id)
    except ShopNotFoundError as e:
        raise HTTPException(status_code=404, detail="ショップが見つかりません") from e

    provider = build_provider(shop, session)
    try:
        item = await provider.get_item(body.item_id)
    except ECAuthError as e:
        raise HTTPException(status_code=400, detail=f"未認証です: {e}") from e
    if item is None:
        raise HTTPException(status_code=400, detail="指定された商品IDが見つかりません")

    service = ScheduleService(session)
    try:
        schedule = await service.create_schedule(body, shop.platform)
    except DuplicatePendingScheduleError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return StockScheduleRead.model_validate(schedule)


@router.get("/{schedule_id}", response_model=StockScheduleRead)
async def get_schedule(
    schedule_id: int, session: AsyncSession = Depends(get_db)
) -> StockScheduleRead:
    service = ScheduleService(session)
    try:
        schedule = await service.get_schedule(schedule_id)
    except ScheduleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return StockScheduleRead.model_validate(schedule)


@router.patch("/{schedule_id}", response_model=StockScheduleRead)
async def update_schedule(
    schedule_id: int, body: StockScheduleUpdate, session: AsyncSession = Depends(get_db)
) -> StockScheduleRead:
    service = ScheduleService(session)
    try:
        schedule = await service.update_schedule(schedule_id, body)
    except ScheduleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ScheduleNotEditableError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return StockScheduleRead.model_validate(schedule)


@router.delete("/{schedule_id}", response_model=StockScheduleRead)
async def cancel_schedule(
    schedule_id: int, session: AsyncSession = Depends(get_db)
) -> StockScheduleRead:
    service = ScheduleService(session)
    try:
        schedule = await service.cancel_schedule(schedule_id)
    except ScheduleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ScheduleNotCancellableError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return StockScheduleRead.model_validate(schedule)
