import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.shop import Shop
from app.models.stock_schedule import ScheduleStatus, StockSchedule
from app.providers.base import ECAuthError, ECMaintenanceError
from app.providers.factory import build_provider
from app.services.event_log_service import EventLogService

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")

_JST = timezone(timedelta(hours=9))


async def poll_due_schedules() -> None:
    """pendingで実行時刻を過ぎたスケジュールを取得し、running に予約してから実行する。

    SELECT ... FOR UPDATE SKIP LOCKED で排他取得することで、
    ポーリング間隔が重なっても二重実行を防ぐ。
    """
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockSchedule)
            .where(
                StockSchedule.status == ScheduleStatus.PENDING.value,
                StockSchedule.run_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
        due_schedules = list(result.scalars().all())
        schedule_ids = [s.id for s in due_schedules]
        for schedule in due_schedules:
            schedule.status = ScheduleStatus.RUNNING.value
        await session.commit()

    for schedule_id in schedule_ids:
        await execute_schedule(schedule_id)


async def execute_schedule(schedule_id: int) -> None:
    async with AsyncSessionLocal() as session:
        schedule = await session.get(StockSchedule, schedule_id)
        if schedule is None or schedule.status != ScheduleStatus.RUNNING.value:
            # 想定外の状態(手動操作等)によるレース。安全側に倒して何もしない。
            return

        shop = await session.get(Shop, schedule.shop_id)
        if shop is None:
            schedule.status = ScheduleStatus.FAILED.value
            schedule.result_message = "ショップが見つかりません(削除された可能性があります)"
            schedule.executed_at = datetime.now(timezone.utc)
            await session.commit()
            return

        provider = build_provider(shop, session)
        try:
            result = await provider.update_stock(schedule.item_id, schedule.target_stock)
            schedule.status = ScheduleStatus.SUCCESS.value if result.success else ScheduleStatus.FAILED.value
            schedule.result_message = result.error_message or "OK"
            schedule.http_status = result.http_status
        except ECMaintenanceError as e:
            # 自動での再実行・実行時刻の変更はしない。失敗として記録し、通知で知らせる
            # (メンテナンス明けに実行してよいかは運用者が判断して再登録する)
            schedule.status = ScheduleStatus.FAILED.value
            schedule.result_message = f"連携先のメンテナンス中のため実行できませんでした: {e}"
            item_label = f"{schedule.item_name}({schedule.item_id})" if schedule.item_name else schedule.item_id
            run_at_jst = schedule.run_at.astimezone(_JST).strftime("%Y-%m-%d %H:%M")
            await EventLogService(session).log(
                category="ec_maintenance",
                level="warning",
                message=(
                    f"ショップ「{shop.name}」のリストック予約を実行できませんでした(連携先のメンテナンス中)\n"
                    f"商品: {item_label}\n"
                    f"在庫数: {schedule.target_stock}\n"
                    f"予定日時: {run_at_jst}\n"
                    f"{e}\n"
                    "自動では再実行しません。必要に応じて予約を登録し直してください。"
                ),
                item_id=schedule.item_id,
                shop_id=shop.id,
            )
        except ECAuthError as e:
            schedule.status = ScheduleStatus.FAILED.value
            schedule.result_message = f"認証エラー(再認証が必要): {e}"
            await EventLogService(session).log(
                category="auth_error",
                level="error",
                message=f"ショップ「{shop.name}」の連携認証エラー(在庫スケジュール実行時): {e}",
                item_id=schedule.item_id,
                shop_id=shop.id,
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("schedule %s の実行中に予期しないエラーが発生しました", schedule_id)
            schedule.status = ScheduleStatus.FAILED.value
            schedule.result_message = f"予期しないエラー: {e}"

        schedule.executed_at = datetime.now(timezone.utc)
        await session.commit()


def start_scheduler() -> None:
    scheduler.add_job(
        poll_due_schedules,
        "interval",
        seconds=settings.schedule_poll_interval_seconds,
        id="poll-due-schedules",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )
    scheduler.start()


def shutdown_scheduler() -> None:
    scheduler.shutdown(wait=False)
