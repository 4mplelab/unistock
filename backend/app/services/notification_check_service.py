from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_alert_state import NotificationAlertState
from app.services.bom_service import BomService
from app.services.notification_service import notify
from app.services.purchase_order_service import PurchaseOrderService
from app.services.shop_service import ShopService


async def _sync_alerts(
    session: AsyncSession, category: str, current: dict[str, tuple[str, list[int | None]]]
) -> None:
    """状態ベースの通知(発注点割れ・発注の納期超過・作成可能数閾値割れ)共通のdedupロジック。

    current: target_key -> (通知メッセージ, shop_ids)、の「現在違反している対象」の集合。
    shop_idsは「この違反が関係しうるショップID一覧」(単一ショップに紐づくイベントなら
    要素1つ、発注点割れのようにショップに紐づかないイベントなら有効な全ショップのID)。
    アクティブなアラート状態(notification_alert_states, resolved_at IS NULL)と突き合わせ、
    新規違反(currentにあってactiveに無い)だけ通知して行を作成し、解消した違反
    (activeにあってcurrentに無い)はresolved_atを立てる。これにより「初めて条件を
    満たした瞬間だけ通知し、満たしたまま毎回は通知しない」edge-triggeredな動作になる。
    """
    active_result = await session.execute(
        select(NotificationAlertState).where(
            NotificationAlertState.category == category, NotificationAlertState.resolved_at.is_(None)
        )
    )
    active = {row.target_key: row for row in active_result.scalars().all()}

    for target_key, (message, shop_ids) in current.items():
        if target_key in active:
            continue
        session.add(NotificationAlertState(category=category, target_key=target_key))
        await notify(session, category, message, shop_ids=shop_ids)

    now = datetime.now(timezone.utc)
    for target_key, row in active.items():
        if target_key not in current:
            row.resolved_at = now

    await session.commit()


async def check_reorder_threshold(session: AsyncSession) -> None:
    rows = await PurchaseOrderService(session).list_reorder_needed()
    if not rows:
        await _sync_alerts(session, "reorder_threshold", {})
        return

    # 発注点割れは部品(ショップに属さない共有在庫)のイベントなので、どの1ショップの話とも
    # 決められない。有効な全ショップの設定(ショップ別上書き→共通のフォールバック)を見て、
    # そのショップが欲しいと言っていれば届ける(notify側で送信先の重複は除去される)
    shop_ids: list[int | None] = [s.id for s in await ShopService(session).list_shops(active_only=True)] or [None]

    current = {
        f"part:{part.id}": (
            f"部品「{part.name}」が発注点を下回りました"
            f"(利用可能 {part.stock - part.reserved} / 発注点 {part.reorder_threshold})",
            shop_ids,
        )
        for part, _has_open_order in rows
    }
    await _sync_alerts(session, "reorder_threshold", current)


async def check_po_overdue(session: AsyncSession) -> None:
    rows = await PurchaseOrderService(session).list_overdue()
    shop_names = {shop.id: shop.name for shop in await ShopService(session).list_shops()}
    current = {
        f"purchase_order:{po.id}": (
            f"発注(ショップ「{shop_names.get(po.shop_id, '?')}」、部品「{part_name}」、"
            f"数量{po.quantity})が予定納期({po.expected_delivery_date})を過ぎても未入荷です",
            [po.shop_id],
        )
        for po, part_name in rows
    }
    await _sync_alerts(session, "po_overdue", current)


async def check_buildable_threshold(session: AsyncSession) -> None:
    bom_service = BomService(session)
    shops = await ShopService(session).list_shops(active_only=True)
    current: dict[str, tuple[str, list[int | None]]] = {}
    for shop in shops:
        thresholds = await bom_service.get_buildable_alert_thresholds(shop.id)
        if not thresholds:
            continue
        for row in await bom_service.compute_item_buildable_counts(shop.id):
            threshold = thresholds.get(row.item_id)
            if threshold is None or row.buildable is None or row.buildable >= threshold:
                continue
            name = row.item_name or row.item_id
            current[f"item:{shop.id}:{row.item_id}"] = (
                f"商品「{name}」(ショップ「{shop.name}」)の作成可能数が{row.buildable}個になりました"
                f"(閾値 {threshold})",
                [shop.id],
            )
    await _sync_alerts(session, "buildable_threshold", current)


async def run_notification_checks(session: AsyncSession) -> None:
    """状態ベースの3つの通知チェックをまとめて実行する(notification_scheduler.pyから呼ぶ)。"""
    await check_reorder_threshold(session)
    await check_po_overdue(session)
    await check_buildable_threshold(session)
