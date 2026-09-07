"""過去に取り込んだ注文でtotal(BASEの注文合計金額)・order_items.total(商品単位の合計金額)が
未取得のものを埋めるバックフィルスクリプト。

0053/0054マイグレーションでOrder.total/OrderItem.totalを追加した時点で、既に取り込み済みの
注文(特に発送確定済みの注文は以後リチェック対象から外れるため自動では埋まらない)はNULLの
まま残る。このスクリプトはそうした注文についてBASEの注文詳細APIを個別に呼び直し、
total関連の列だけを補う(在庫操作・商品ステータス同期など他の取り込み処理には一切触れない)。

使い方:
    docker compose exec backend python scripts/backfill_order_totals.py

注文数が多いショップでは呼び出し回数がその分増えるため、BASE側のレート制限に注意すること。
"""

import asyncio
import logging
import sys

sys.path.insert(0, "/app")

from sqlalchemy import or_, select

from app.core.security import init_fernet_key
from app.database import AsyncSessionLocal
from app.models.order import Order, OrderItem
from app.providers.base import IECProvider
from app.providers.factory import build_provider
from app.services.auth_service import ensure_token_encryption_key
from app.services.shop_service import ShopService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    async with AsyncSessionLocal() as session:
        # 通常はFastAPIのlifespanで初期化されるが、このスクリプトは単独実行のため
        # OAuthトークン復号(get_order_detail内)の前に自前で初期化する
        init_fernet_key(await ensure_token_encryption_key(session))

        missing_item_totals = select(OrderItem.order_id).where(OrderItem.total.is_(None))
        result = await session.execute(
            select(Order.id, Order.shop_id, Order.unique_key).where(
                or_(Order.total.is_(None), Order.id.in_(missing_item_totals))
            )
        )
        # rollback()はセッション内の全ORMオブジェクトを期限切れにする(次のアクセスで再読込が
        # 走る)ため、1件失敗しても他の注文の属性アクセスに影響しないよう、先にプレーンな
        # タプルへ取り出しておく(注文・商品明細オブジェクト自体は更新の直前に都度取り直す)
        targets = result.all()
        if not targets:
            print("バックフィル対象の注文はありません。")
            return

        shop_service = ShopService(session)
        providers: dict[int, IECProvider] = {}
        updated = 0
        failed = 0

        for order_id, shop_id, unique_key in targets:
            try:
                if shop_id not in providers:
                    shop = await shop_service.get_shop(shop_id)
                    providers[shop_id] = build_provider(shop, session)
                detail = await providers[shop_id].get_order_detail(unique_key)
                if detail is None:
                    logger.warning("注文 %s の詳細が取得できませんでした", unique_key)
                    failed += 1
                    continue

                order = await session.get(Order, order_id)
                if detail.total is not None:
                    order.total = detail.total

                # order_items.totalの突き合わせは_sync_item_statuses(order_ingestion_service)と
                # 同じ照合ロジック: base_order_item_id優先、無ければitem_id+variation_idで代替照合
                existing_items = list(
                    (await session.execute(select(OrderItem).where(OrderItem.order_id == order_id)))
                    .scalars()
                    .all()
                )
                by_base_id = {oi.base_order_item_id: oi for oi in existing_items if oi.base_order_item_id}
                legacy_by_key = {
                    (oi.item_id, oi.variation_id): oi for oi in existing_items if not oi.base_order_item_id
                }
                for detail_item in detail.items:
                    order_item = None
                    if detail_item.order_item_id:
                        order_item = by_base_id.get(detail_item.order_item_id)
                    if order_item is None:
                        order_item = legacy_by_key.get((detail_item.item_id, detail_item.variation_id))
                    if order_item is None or detail_item.total is None:
                        continue
                    order_item.total = detail_item.total

                await session.commit()
                updated += 1
            except Exception:  # noqa: BLE001
                logger.exception("注文 %s の処理中にエラーが発生しました", unique_key)
                await session.rollback()
                failed += 1

        print(f"完了: 更新{updated}件・失敗{failed}件(対象{len(targets)}件)")


if __name__ == "__main__":
    asyncio.run(main())
