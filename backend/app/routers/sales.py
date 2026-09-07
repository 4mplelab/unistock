from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.sales import SalesSummaryRead
from app.services.auth_service import require_auth
from app.services.sales_service import get_sales_summary

router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(require_auth)])


@router.get("/summary", response_model=SalesSummaryRead)
async def sales_summary(
    days: int = 30,
    shop_id: int | None = None,
    date_basis: Literal["dispatched", "ordered"] = "dispatched",
    session: AsyncSession = Depends(get_db),
) -> SalesSummaryRead:
    return await get_sales_summary(session, days=days, shop_id=shop_id, date_basis=date_basis)
