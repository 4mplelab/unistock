from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.nav_counts import NavCountsRead
from app.services.auth_service import require_auth
from app.services.nav_counts_service import get_nav_counts

router = APIRouter(prefix="/api/nav-counts", tags=["nav-counts"], dependencies=[Depends(require_auth)])


@router.get("", response_model=NavCountsRead)
async def read_nav_counts(
    event_logs_since: datetime | None = None,
    shop_id: int | None = None,
    session: AsyncSession = Depends(get_db),
) -> NavCountsRead:
    return await get_nav_counts(session, event_logs_since=event_logs_since, shop_id=shop_id)
