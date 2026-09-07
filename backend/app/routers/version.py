from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.auth_service import require_auth
from app.services.version_check_service import check_for_update

router = APIRouter(prefix="/api/version", tags=["version"], dependencies=[Depends(require_auth)])


@router.get("/check-update")
async def check_update(session: AsyncSession = Depends(get_db)) -> dict[str, str | bool] | None:
    return await check_for_update(session)
