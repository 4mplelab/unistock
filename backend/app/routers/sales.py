from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.sales import RecalculateCostsRequest, SalesSummaryRead
from app.services.auth_service import require_admin, require_auth
from app.services.data_reset_service import ConfirmationMismatchError
from app.services.sales_service import RECALCULATE_COSTS_PHRASE, get_sales_summary, recalculate_order_item_costs

router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(require_auth)])


@router.get("/summary", response_model=SalesSummaryRead)
async def sales_summary(
    days: int = 30,
    shop_id: int | None = None,
    date_basis: Literal["dispatched", "ordered"] = "dispatched",
    start_date: date | None = None,
    end_date: date | None = None,
    session: AsyncSession = Depends(get_db),
) -> SalesSummaryRead:
    """start_date/end_date(暦日、両端含む)を指定すると、daysより優先してその期間で集計する。"""
    return await get_sales_summary(
        session, days=days, shop_id=shop_id, date_basis=date_basis, start_date=start_date, end_date=end_date
    )


@router.get("/recalculate-costs-phrase")
async def recalculate_costs_phrase() -> dict[str, str]:
    """確認ダイアログに表示する、入力必須の確認文字列をフロントへ渡す。"""
    return {"phrase": RECALCULATE_COSTS_PHRASE}


@router.post("/recalculate-costs", dependencies=[Depends(require_admin)])
async def recalculate_costs(
    shop_id: int, body: RecalculateCostsRequest, session: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="デモモードではこの操作はできません")
    try:
        updated_count = await recalculate_order_item_costs(session, shop_id, body.confirm_phrase)
    except ConfirmationMismatchError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"updated_count": updated_count}
