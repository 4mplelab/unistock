from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.event_log import EventLogListRead, EventLogRead
from app.services.auth_service import require_auth
from app.services.event_log_service import EventLogService

router = APIRouter(prefix="/api/event-logs", tags=["event-logs"], dependencies=[Depends(require_auth)])


@router.get("", response_model=EventLogListRead)
async def list_event_logs(
    limit: int = 20,
    offset: int = 0,
    highlight: int | None = None,
    shop_id: int | None = None,
    include_shared: bool = True,
    session: AsyncSession = Depends(get_db),
) -> EventLogListRead:
    service = EventLogService(session)
    rows, total, page = await service.list_recent(
        limit=limit, offset=offset, highlight=highlight, shop_id=shop_id, include_shared=include_shared
    )
    return EventLogListRead(
        items=[
            EventLogRead(
                id=event_log.id,
                category=event_log.category,
                level=event_log.level,
                message=event_log.message,
                order_id=event_log.order_id,
                order_unique_key=order_unique_key,
                item_id=event_log.item_id,
                shop_id=event_log.shop_id,
                created_at=event_log.created_at,
                occurrence_count=event_log.occurrence_count,
                last_occurred_at=event_log.last_occurred_at,
            )
            for event_log, order_unique_key in rows
        ],
        total=total,
        page=page,
    )
