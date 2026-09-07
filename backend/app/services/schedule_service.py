from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock_schedule import ScheduleStatus, StockSchedule
from app.schemas.stock_schedule import StockScheduleCreate, StockScheduleUpdate


class ScheduleNotFoundError(Exception):
    pass


class ScheduleNotCancellableError(Exception):
    pass


class ScheduleNotEditableError(Exception):
    pass


class DuplicatePendingScheduleError(Exception):
    pass


class ScheduleService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_schedules(
        self, limit: int = 20, offset: int = 0, shop_id: int | None = None, status: str | None = None
    ) -> tuple[list[StockSchedule], int]:
        # 未実行(pending)を絞り込む場合は「次に実行される順」が見たいので昇順、それ以外は
        # 従来通り新しい順(直近の実行結果を先頭に見せる一覧画面のデフォルト表示に合わせる)
        order = StockSchedule.run_at.asc() if status == ScheduleStatus.PENDING.value else StockSchedule.run_at.desc()
        total_stmt = select(func.count()).select_from(StockSchedule)
        list_stmt = select(StockSchedule).order_by(order).limit(limit).offset(offset)
        if shop_id is not None:
            total_stmt = total_stmt.where(StockSchedule.shop_id == shop_id)
            list_stmt = list_stmt.where(StockSchedule.shop_id == shop_id)
        if status is not None:
            total_stmt = total_stmt.where(StockSchedule.status == status)
            list_stmt = list_stmt.where(StockSchedule.status == status)
        total = (await self._session.execute(total_stmt)).scalar_one()
        result = await self._session.execute(list_stmt)
        return list(result.scalars().all()), total

    async def create_schedule(self, data: StockScheduleCreate, platform: str) -> StockSchedule:
        existing = await self._session.execute(
            select(StockSchedule).where(
                StockSchedule.shop_id == data.shop_id,
                StockSchedule.item_id == data.item_id,
                StockSchedule.status == ScheduleStatus.PENDING.value,
            )
        )
        if existing.scalars().first() is not None:
            raise DuplicatePendingScheduleError(
                f"item_id={data.item_id} は既に実行待ちのスケジュールが登録されています"
            )

        schedule = StockSchedule(
            shop_id=data.shop_id,
            platform=platform,
            item_id=data.item_id,
            item_name=data.item_name,
            target_stock=data.target_stock,
            run_at=data.run_at,
            status=ScheduleStatus.PENDING.value,
        )
        self._session.add(schedule)
        await self._session.commit()
        await self._session.refresh(schedule)
        return schedule

    async def get_schedule(self, schedule_id: int) -> StockSchedule:
        schedule = await self._session.get(StockSchedule, schedule_id)
        if schedule is None:
            raise ScheduleNotFoundError(f"schedule {schedule_id} not found")
        return schedule

    async def update_schedule(self, schedule_id: int, data: StockScheduleUpdate) -> StockSchedule:
        schedule = await self.get_schedule(schedule_id)
        if schedule.status != ScheduleStatus.PENDING.value:
            raise ScheduleNotEditableError(
                f"schedule {schedule_id} は pending 以外のため編集できません(status={schedule.status})"
            )
        schedule.target_stock = data.target_stock
        schedule.run_at = data.run_at
        await self._session.commit()
        await self._session.refresh(schedule)
        return schedule

    async def cancel_schedule(self, schedule_id: int) -> StockSchedule:
        schedule = await self._session.get(StockSchedule, schedule_id)
        if schedule is None:
            raise ScheduleNotFoundError(f"schedule {schedule_id} not found")
        if schedule.status != ScheduleStatus.PENDING.value:
            raise ScheduleNotCancellableError(
                f"schedule {schedule_id} は pending 以外のため取消できません(status={schedule.status})"
            )
        schedule.status = ScheduleStatus.CANCELLED.value
        await self._session.commit()
        await self._session.refresh(schedule)
        return schedule
