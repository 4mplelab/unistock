from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.order import Order, OrderItem, OrderItemOption
from app.schemas.order import (
    IngestionResultRead,
    OrderDispatchStatusUpdate,
    OrderItemOptionRead,
    OrderItemPickedUpdate,
    OrderItemRead,
    OrderListRead,
    OrderRead,
)
from app.schemas.order_summary import OrderSummaryRead
from app.providers.manual_ec import ManualECProvider
from app.services.auth_service import require_auth
from app.services.order_ingestion_service import OrderIngestionService
from app.services.order_scheduler import run_sync_once
from app.services.order_summary_service import get_order_summary

router = APIRouter(prefix="/api/orders", tags=["orders"], dependencies=[Depends(require_auth)])


async def _load_items_map(session: AsyncSession, order_ids: list[int]) -> dict[int, list[OrderItem]]:
    if not order_ids:
        return {}
    result = await session.execute(select(OrderItem).where(OrderItem.order_id.in_(order_ids)))
    items_map: dict[int, list[OrderItem]] = {}
    for item in result.scalars().all():
        items_map.setdefault(item.order_id, []).append(item)
    return items_map


async def _load_options_map(session: AsyncSession, order_item_ids: list[int]) -> dict[int, list[OrderItemOption]]:
    if not order_item_ids:
        return {}
    result = await session.execute(
        select(OrderItemOption)
        .where(OrderItemOption.order_item_id.in_(order_item_ids))
        .order_by(OrderItemOption.sort_order.asc().nulls_last(), OrderItemOption.id.asc())
    )
    options_map: dict[int, list[OrderItemOption]] = {}
    for option in result.scalars().all():
        options_map.setdefault(option.order_item_id, []).append(option)
    return options_map


def _to_read(order: Order, items: list[OrderItem], options_map: dict[int, list[OrderItemOption]]) -> OrderRead:
    return OrderRead(
        id=order.id,
        shop_id=order.shop_id,
        platform=order.platform,
        unique_key=order.unique_key,
        dispatch_status=order.dispatch_status,
        ordered_at=order.ordered_at,
        dispatched_at=order.dispatched_at,
        cancelled_at=order.cancelled_at,
        modified_at=order.modified_at,
        total_amount=order.total,
        last_name=order.last_name,
        first_name=order.first_name,
        prefecture=order.prefecture,
        address=order.address,
        email=order.email,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=[
            OrderItemRead(
                id=i.id,
                item_id=i.item_id,
                title=i.title,
                quantity=i.quantity,
                price=i.price,
                variation=i.variation,
                status=i.status,
                picked=i.picked,
                options=[OrderItemOptionRead.model_validate(o) for o in options_map.get(i.id, [])],
            )
            for i in items
        ],
    )


@router.get("", response_model=OrderListRead)
async def list_orders(
    limit: int = 20,
    offset: int = 0,
    highlight: str | None = None,
    shop_id: int | None = None,
    include_cancelled: bool = True,
    session: AsyncSession = Depends(get_db),
) -> OrderListRead:
    """注文一覧。取引ログ的に増え続けるデータのため全件取得はせず、limit/offsetでページ単位を返す。

    shop_idが指定された場合、そのショップの注文のみに絞り込む(未指定なら全ショップ)。
    include_cancelled=Falseの場合、キャンセル済み(dispatch_status="cancelled")の注文を除外する。
    highlight(unique_key)が指定された場合、そのクライアント指定のoffsetは無視し、
    その注文が含まれるページを自動的に計算して返す(イベントログ・在庫変動履歴から
    「この注文を見る」で遷移してきた場合に、クライアント側で全件検索する必要をなくす)。
    """
    total_stmt = select(func.count()).select_from(Order)
    if shop_id is not None:
        total_stmt = total_stmt.where(Order.shop_id == shop_id)
    if not include_cancelled:
        total_stmt = total_stmt.where(Order.dispatch_status != "cancelled")
    total = (await session.execute(total_stmt)).scalar_one()

    if highlight:
        target_stmt = select(Order).where(Order.unique_key == highlight)
        if shop_id is not None:
            target_stmt = target_stmt.where(Order.shop_id == shop_id)
        target = (await session.execute(target_stmt)).scalars().first()
        if target is not None:
            preceding_stmt = select(func.count()).select_from(Order).where(Order.ordered_at > target.ordered_at)
            if shop_id is not None:
                preceding_stmt = preceding_stmt.where(Order.shop_id == shop_id)
            if not include_cancelled:
                preceding_stmt = preceding_stmt.where(Order.dispatch_status != "cancelled")
            preceding = (await session.execute(preceding_stmt)).scalar_one()
            offset = (preceding // limit) * limit

    list_stmt = select(Order).order_by(Order.ordered_at.desc()).limit(limit).offset(offset)
    if shop_id is not None:
        list_stmt = list_stmt.where(Order.shop_id == shop_id)
    if not include_cancelled:
        list_stmt = list_stmt.where(Order.dispatch_status != "cancelled")
    result = await session.execute(list_stmt)
    orders = list(result.scalars().all())
    items_map = await _load_items_map(session, [o.id for o in orders])
    all_item_ids = [i.id for items in items_map.values() for i in items]
    options_map = await _load_options_map(session, all_item_ids)
    page = offset // limit + 1 if limit > 0 else 1
    return OrderListRead(
        items=[_to_read(o, items_map.get(o.id, []), options_map) for o in orders],
        total=total,
        page=page,
    )


@router.get("/summary", response_model=OrderSummaryRead)
async def order_summary(
    dispatch_status: str = "ordered",
    unique_keys: str | None = None,
    shop_id: int | None = None,
    session: AsyncSession = Depends(get_db),
) -> OrderSummaryRead:
    keys = unique_keys.split(",") if unique_keys else None
    return await get_order_summary(session, dispatch_status=dispatch_status, unique_keys=keys, shop_id=shop_id)


@router.patch("/items/{order_item_id}/picked", response_model=OrderItemRead)
async def update_order_item_picked(
    order_item_id: int, payload: OrderItemPickedUpdate, session: AsyncSession = Depends(get_db)
) -> OrderItemRead:
    """ピッキング完了チェック。連携先のdispatch_statusとは独立したUniStock内だけのフラグで、
    在庫や引当には一切影響しない(表示用)。
    """
    item = await session.get(OrderItem, order_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"order_item {order_item_id} not found")
    item.picked = payload.picked
    await session.commit()
    options_map = await _load_options_map(session, [item.id])
    return OrderItemRead(
        id=item.id,
        item_id=item.item_id,
        title=item.title,
        quantity=item.quantity,
        price=item.price,
        variation=item.variation,
        status=item.status,
        picked=item.picked,
        options=[OrderItemOptionRead.model_validate(o) for o in options_map.get(item.id, [])],
    )


@router.get("/{order_id}", response_model=OrderRead)
async def get_order(order_id: int, session: AsyncSession = Depends(get_db)) -> OrderRead:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")
    items_map = await _load_items_map(session, [order.id])
    items = items_map.get(order.id, [])
    options_map = await _load_options_map(session, [i.id for i in items])
    return _to_read(order, items, options_map)


@router.patch("/{order_id}/dispatch-status", response_model=OrderRead)
async def update_manual_order_dispatch_status(
    order_id: int, body: OrderDispatchStatusUpdate, session: AsyncSession = Depends(get_db)
) -> OrderRead:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")

    provider = ManualECProvider(session, order.shop_id)
    service = OrderIngestionService(session, provider, order.shop_id)
    try:
        await service.set_manual_dispatch_status(order, body.dispatch_status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    # set_manual_dispatch_status内の複数回のcommitでorderの属性がexpireされているため、
    # _to_readでの同期アクセス前に明示的にリフレッシュする
    await session.refresh(order)
    items_map = await _load_items_map(session, [order.id])
    items = items_map.get(order.id, [])
    options_map = await _load_options_map(session, [i.id for i in items])
    return _to_read(order, items, options_map)


@router.post("/{order_id}/undo-dispatch", response_model=OrderRead)
async def undo_manual_order_dispatch(order_id: int, session: AsyncSession = Depends(get_db)) -> OrderRead:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")

    provider = ManualECProvider(session, order.shop_id)
    service = OrderIngestionService(session, provider, order.shop_id)
    try:
        await service.undo_dispatch(order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    await session.refresh(order)
    items_map = await _load_items_map(session, [order.id])
    items = items_map.get(order.id, [])
    options_map = await _load_options_map(session, [i.id for i in items])
    return _to_read(order, items, options_map)


@router.post("/sync", response_model=IngestionResultRead)
async def sync_orders(session: AsyncSession = Depends(get_db)) -> IngestionResultRead:
    result = await run_sync_once(session)
    return IngestionResultRead(
        orders_seen=result.orders_seen,
        new_orders=result.new_orders,
        transitioned_orders=result.transitioned_orders,
        errors=result.errors,
    )
