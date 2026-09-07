import logging

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.notification_check_service import run_notification_checks
from app.services.scheduler import scheduler

logger = logging.getLogger(__name__)

JOB_ID = "notification-checks"


async def run_notification_checks_job() -> None:
    async with AsyncSessionLocal() as session:
        try:
            await run_notification_checks(session)
        except Exception:  # noqa: BLE001
            logger.exception("通知チェックの実行中にエラーが発生しました")
            await session.rollback()


def start_notification_scheduler() -> None:
    scheduler.add_job(
        run_notification_checks_job,
        "interval",
        seconds=settings.notification_check_interval_seconds,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )


def shutdown_notification_scheduler() -> None:
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
