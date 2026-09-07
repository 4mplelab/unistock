from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.order import Order
from app.models.part import Part
from app.models.stock_movement import StockMovement
from app.schemas.stock_movement import (
    AssemblyBuildSummaryPoint,
    AssemblyBuildSummaryRead,
    ConsumptionSummaryPoint,
    ConsumptionSummaryRead,
    ConsumptionSummarySeries,
    StockMovementListRead,
    StockMovementRead,
)


async def record_part_movement(
    session: AsyncSession,
    part_id: int,
    quantity: int,
    reason: str,
    note: str | None = None,
    order_id: int | None = None,
    purchase_order_id: int | None = None,
    shop_id: int | None = None,
) -> None:
    if quantity == 0:
        return
    session.add(
        StockMovement(
            part_id=part_id,
            quantity=quantity,
            reason=reason,
            note=note,
            order_id=order_id,
            purchase_order_id=purchase_order_id,
            shop_id=shop_id,
        )
    )


async def record_assembly_movement(
    session: AsyncSession,
    assembly_id: int,
    quantity: int,
    reason: str,
    note: str | None = None,
    order_id: int | None = None,
    shop_id: int | None = None,
) -> None:
    if quantity == 0:
        return
    session.add(
        StockMovement(
            assembly_id=assembly_id,
            quantity=quantity,
            reason=reason,
            note=note,
            order_id=order_id,
            shop_id=shop_id,
        )
    )


@dataclass
class StockMovementRow:
    movement: StockMovement
    component_type: str
    component_id: int
    component_name: str
    order_unique_key: str | None


@dataclass
class StockMovementPage:
    rows: list[StockMovementRow]
    total: int


async def list_movements(
    session: AsyncSession,
    *,
    part_id: int | None = None,
    assembly_id: int | None = None,
    component_type: str | None = None,
    reason: str | None = None,
    order_unique_key: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    shop_id: int | None = None,
    include_shared: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> StockMovementPage:
    """在庫変動履歴を条件で絞り込み、ページ単位で返す(全件をメモリに載せない)。

    stock_movementsは注文が処理されるたびに増え続ける取引ログであり、部品/中間品
    マスタのような「緩やかにしか増えないカタログ」とは性質が異なる。件数が際限なく
    増える前提で、必ずlimit/offsetで絞ってから返す。

    shop_idを渡すとそのショップの行に絞り込む。include_shared(既定True)がTrueの
    間は、手動調整・組立操作などshop_id無し(真に共通)の行も一緒に含める。
    """
    stmt = (
        select(StockMovement, Order.unique_key, Part.name, Assembly.name)
        .outerjoin(Order, Order.id == StockMovement.order_id)
        .outerjoin(Part, Part.id == StockMovement.part_id)
        .outerjoin(Assembly, Assembly.id == StockMovement.assembly_id)
    )

    if part_id is not None:
        stmt = stmt.where(StockMovement.part_id == part_id)
    if assembly_id is not None:
        stmt = stmt.where(StockMovement.assembly_id == assembly_id)
    if component_type == "part":
        stmt = stmt.where(StockMovement.part_id.is_not(None))
    elif component_type == "assembly":
        stmt = stmt.where(StockMovement.assembly_id.is_not(None))
    if reason is not None:
        stmt = stmt.where(StockMovement.reason == reason)
    if order_unique_key:
        stmt = stmt.where(Order.unique_key.ilike(f"%{order_unique_key}%"))
    if date_from is not None:
        stmt = stmt.where(StockMovement.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(StockMovement.created_at <= date_to)
    if shop_id is not None:
        if include_shared:
            stmt = stmt.where(or_(StockMovement.shop_id == shop_id, StockMovement.shop_id.is_(None)))
        else:
            stmt = stmt.where(StockMovement.shop_id == shop_id)

    count_result = await session.execute(select(func.count()).select_from(stmt.subquery()))
    total = count_result.scalar_one()

    stmt = stmt.order_by(StockMovement.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(stmt)

    rows = [
        StockMovementRow(
            movement=movement,
            component_type="part" if movement.part_id is not None else "assembly",
            component_id=movement.part_id if movement.part_id is not None else movement.assembly_id,
            component_name=part_name if movement.part_id is not None else assembly_name,
            order_unique_key=order_unique_key,
        )
        for movement, order_unique_key, part_name, assembly_name in result.all()
    ]
    return StockMovementPage(rows=rows, total=total)


def row_to_read(row: StockMovementRow) -> StockMovementRead:
    m = row.movement
    return StockMovementRead(
        id=m.id,
        component_type=row.component_type,
        component_id=row.component_id,
        component_name=row.component_name,
        quantity=m.quantity,
        reason=m.reason,
        note=m.note,
        order_id=m.order_id,
        order_unique_key=row.order_unique_key,
        purchase_order_id=m.purchase_order_id,
        shop_id=m.shop_id,
        created_at=m.created_at,
    )


def page_to_read(page: StockMovementPage) -> StockMovementListRead:
    return StockMovementListRead(items=[row_to_read(r) for r in page.rows], total=page.total)


async def get_consumption_summary(session: AsyncSession, days: int = 30, top_n: int = 5) -> ConsumptionSummaryRead:
    """直近days日間で消費数量(reason=order_consumed)が多い部品/中間品、上位top_n件について、
    日別の消費数量推移をダッシュボードのグラフ用に返す。quantityは負数(減少)で記録されて
    いるため、符号反転して正の消費数量として扱う。
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    totals_stmt = (
        select(
            StockMovement.part_id,
            StockMovement.assembly_id,
            func.sum(-StockMovement.quantity).label("total"),
        )
        .where(StockMovement.reason == "order_consumed", StockMovement.created_at >= since)
        .group_by(StockMovement.part_id, StockMovement.assembly_id)
        .order_by(func.sum(-StockMovement.quantity).desc())
        .limit(top_n)
    )
    totals_result = await session.execute(totals_stmt)
    top_rows = totals_result.all()
    if not top_rows:
        return ConsumptionSummaryRead(days=days, series=[])

    part_ids = [r.part_id for r in top_rows if r.part_id is not None]
    assembly_ids = [r.assembly_id for r in top_rows if r.assembly_id is not None]

    parts_map: dict[int, str] = {}
    if part_ids:
        parts_result = await session.execute(select(Part.id, Part.name).where(Part.id.in_(part_ids)))
        parts_map = dict(parts_result.all())
    assemblies_map: dict[int, str] = {}
    if assembly_ids:
        assemblies_result = await session.execute(select(Assembly.id, Assembly.name).where(Assembly.id.in_(assembly_ids)))
        assemblies_map = dict(assemblies_result.all())

    day_expr = func.date_trunc("day", StockMovement.created_at).label("day")
    component_filter = or_(
        StockMovement.part_id.in_(part_ids) if part_ids else False,
        StockMovement.assembly_id.in_(assembly_ids) if assembly_ids else False,
    )
    daily_stmt = (
        select(day_expr, StockMovement.part_id, StockMovement.assembly_id, func.sum(-StockMovement.quantity))
        .where(StockMovement.reason == "order_consumed", StockMovement.created_at >= since, component_filter)
        .group_by(day_expr, StockMovement.part_id, StockMovement.assembly_id)
        .order_by(day_expr)
    )
    daily_result = await session.execute(daily_stmt)

    points_by_component: dict[tuple[str, int], list[ConsumptionSummaryPoint]] = {}
    for day, part_id, assembly_id, quantity in daily_result.all():
        key = ("part", part_id) if part_id is not None else ("assembly", assembly_id)
        points_by_component.setdefault(key, []).append(ConsumptionSummaryPoint(date=day.date(), quantity=quantity))

    series: list[ConsumptionSummarySeries] = []
    for row in top_rows:
        if row.part_id is not None:
            key = ("part", row.part_id)
            name = parts_map.get(row.part_id, "(不明)")
        else:
            key = ("assembly", row.assembly_id)
            name = assemblies_map.get(row.assembly_id, "(不明)")
        series.append(
            ConsumptionSummarySeries(
                component_type=key[0],
                component_id=key[1],
                component_name=name,
                total=row.total,
                points=points_by_component.get(key, []),
            )
        )
    return ConsumptionSummaryRead(days=days, series=series)


async def get_assembly_build_summary(session: AsyncSession, days: int = 30) -> AssemblyBuildSummaryRead:
    """直近days日間の中間品組立(reason=assembly_build)の日別合計数量を返す。"""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    day_expr = func.date_trunc("day", StockMovement.created_at).label("day")
    stmt = (
        select(day_expr, func.sum(StockMovement.quantity))
        .where(StockMovement.reason == "assembly_build", StockMovement.created_at >= since)
        .group_by(day_expr)
        .order_by(day_expr)
    )
    result = await session.execute(stmt)
    points = [AssemblyBuildSummaryPoint(date=day.date(), quantity=quantity) for day, quantity in result.all()]
    return AssemblyBuildSummaryRead(days=days, points=points)
