"""デモデータ投入の実行用スクリプト(ロジック本体は app/services/demo_seed_service.py)。

使い方:
    docker compose exec backend python scripts/seed_demo_data.py

BASEのshopが無ければ作成し、あれば使い回してそこにデモデータを投入する。
UI(初回セットアップウィザードの「デモ用のサンプルデータを投入する」ボタン、
POST /api/shops/{shop_id}/seed-demo)と同じロジックを、shopの用意まで含めて
ワンコマンドで叩ける開発者向けの近道。同じショップに既に投入済みなら
seed_demo_data_base自身が何もせずFalseを返す(二重投入エラーの防止込み)。
"""

import asyncio
import sys

sys.path.insert(0, "/app")

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.shop import Shop
from app.services.demo_seed_service import seed_demo_data_base


async def main() -> None:
    async with AsyncSessionLocal() as session:
        shop = (await session.execute(select(Shop).where(Shop.platform == "base").limit(1))).scalars().first()
        if shop is None:
            shop = Shop(platform="base", name="BASEショップ(デモ)")
            session.add(shop)
            await session.flush()

        seeded = await seed_demo_data_base(session, shop)
        if not seeded:
            print(f"「{shop.name}」(id={shop.id})には既にデモデータが投入済みのようです。何もせず終了します。")
            print("作り直す場合は設定画面の「データ管理」で一度消去してから再実行してください。")
            return

        print(f"「{shop.name}」(id={shop.id})にデモデータを投入しました。")
        print("- 部品マスタ: 6件(うち1件は発注点を下回る例)")
        print("- 中間品マスタ: 1件(組立履歴2件つき)")
        print("- BOM: test-item-001(共通/オプション/種類/組み合わせの全パターン)、test-item-002(共通のみ)")
        print("- 注文: 発送済み・未対応・キャンセル済み・入金待ち各1件")
        print("- 発注: 未入荷・入荷済み各1件")
        print("- 在庫スケジューラー: 実行待ち1件")


if __name__ == "__main__":
    asyncio.run(main())
