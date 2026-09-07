from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.stock_movement import (
    AssemblyBuildSummaryRead,
    ComponentTypeLiteral,
    ConsumptionSummaryRead,
    StockMovementListRead,
    StockMovementReasonLiteral,
)
from app.services.auth_service import require_auth
from app.services.stock_movement_service import (
    get_assembly_build_summary,
    get_consumption_summary,
    list_movements,
    page_to_read,
)

router = APIRouter(prefix="/api/stock-movements", tags=["stock-movements"], dependencies=[Depends(require_auth)])


@router.get("/consumption-summary", response_model=ConsumptionSummaryRead)
async def consumption_summary(
    days: int = 30, top_n: int = 5, session: AsyncSession = Depends(get_db)
) -> ConsumptionSummaryRead:
    return await get_consumption_summary(session, days=days, top_n=top_n)


@router.get("/assembly-build-summary", response_model=AssemblyBuildSummaryRead)
async def assembly_build_summary(days: int = 30, session: AsyncSession = Depends(get_db)) -> AssemblyBuildSummaryRead:
    return await get_assembly_build_summary(session, days=days)


@router.get("", response_model=StockMovementListRead)
async def list_stock_movements(
    component_type: ComponentTypeLiteral | None = None,
    part_id: int | None = None,
    assembly_id: int | None = None,
    reason: StockMovementReasonLiteral | None = None,
    order_unique_key: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    shop_id: int | None = None,
    include_shared: bool = True,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_db),
) -> StockMovementListRead:
    page = await list_movements(
        session,
        part_id=part_id,
        assembly_id=assembly_id,
        component_type=component_type,
        reason=reason,
        order_unique_key=order_unique_key,
        date_from=date_from,
        date_to=date_to,
        shop_id=shop_id,
        include_shared=include_shared,
        limit=limit,
        offset=offset,
    )
    return page_to_read(page)
