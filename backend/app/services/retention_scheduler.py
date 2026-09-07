import logging

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.event_log_service import EventLogService
from app.services.retention_service import RetentionService
from app.services.scheduler import scheduler

logger = logging.getLogger(__name__)

JOB_ID = "cleanup-retention"


async def run_retention_cleanup() -> dict[str, int]:
    async with AsyncSessionLocal() as session:
        service = RetentionService(session)
        counts = await service.run_all()
        if sum(counts.values()):
            logger.info("保持期間切れデータを削除しました: %s", counts)
            await EventLogService(session).log(
                category="retention_cleanup",
                level="info",
                message=f"保持期間切れデータを削除しました: {counts}",
            )
        return counts


def start_retention_scheduler() -> None:
    scheduler.add_job(
        run_retention_cleanup,
        "interval",
        hours=settings.retention_cleanup_interval_hours,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )


def shutdown_retention_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
