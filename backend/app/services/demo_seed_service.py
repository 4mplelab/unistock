"""UniStockの機能を一通り体験できるデモデータを投入するサービス。

ソースを公開するにあたり、初めて触る人がBOMのオプション/種類/組み合わせ条件、
注文の各ステータス、ピッキング進捗、発注リードタイム、中間品の多段構成、
ダッシュボードの各カード/グラフなど主要機能を一覧・編集画面ですぐに確認できる
ようにするためのもの。`scripts/seed_demo_data.py`と、初回セットアップ
ウィザード(フロント`ShopSetupFlow`)の「デモ用のサンプルデータを投入する」
ボタン(`POST /api/shops/{shop_id}/seed-demo`)の両方から呼ばれる。

2フェーズに分かれている:
    - 共有マスタ(部品/中間品/見た目のための消費履歴/業務イベントログ)は
      ショップに依存しないため、`_seed_shared_demo_master`で初回のみ投入する
      (`is_demo_data_seeded`で判定。part.skuが`DEMO-NUT-M3`なら投入済み)
    - BOM/注文/在庫スケジュール/発注管理はshop_idに紐づく(発注管理はshop_id必須の
      ため)、`_seed_shop_scoped_demo_data`で呼ばれるたびに(=ショップごとに何度でも)
      投入する。複数ショップぶん投入すると、それぞれの注文引当が同じ共有部品在庫を
      実際に消費する(UniStock本来の複数ショップ間の在庫の取り合いをそのままデモできる)
    - `seed_demo_data_base`/`seed_demo_data_manual`はこの2フェーズを繋ぐオーケストレーション
      関数。さらに他プラットフォームに対応する際は、同じ形の`seed_demo_data_xxx(session, shop)`
      関数を書いて`_SEEDERS`に登録すればよい

前提・制約:
    - BASEの認証(OAuth)は不要。BOM編集画面で使う商品は`app/providers/test_items.py`の
      テスト用ID(test-item-001〜003)を使うため、認証なしでも一覧・編集画面が動作する
    - ただし、BomEditPageの「オプション」「種類」カードはBASEから選択肢を都度取得する
      仕組みのため、BASE未認証の状態では新規追加ができない(投入済みのBOM行の閲覧・
      数量変更・削除は可能)。実際にオプション/種類を新規追加する動作まで試したい
      場合は、READMEの手順でBASE認証を行うこと
    - 手動管理ショップ(`seed_demo_data_manual`)向けの商品(demo-manual-001〜003)は
      ManualItem/ManualItemVariationとして実際に永続化する(BASEと違い商品の実体を
      持つ一次情報がこのテーブル自体のため)。オプション機構が無いためBOMは共通行+
      単一軸バリエーション条件のみ、注文もordered→dispatched/cancelledの2状態にしか
      遷移しない分、BASE版よりデータ量は少ない。リストック予約はBASEの出品在庫を
      予約更新する機能のため、手動ショップには投入しない
    - ダッシュボードのグラフ(部品消費トレンド・中間品組立稼働状況)向けに、実際の注文・
      組立操作を経由しない「見た目のための」stock_movements行を直接挿入している箇所が
      ある(コメントで明記)。これらはorder_id/purchase_order_idを持たない、集計専用の
      デモ用データで、実引当ロジックの整合性には影響しない
"""

import random
import secrets
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.assembly_item import AssemblyItem
from app.models.bom import BomItem, BomItemCondition
from app.models.bom_product_setting import BomProductSetting
from app.models.event_log import EventLog
from app.models.item_category import ItemCategory
from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.models.order import DispatchStatus, Order, OrderItem, OrderItemOption
from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from app.models.shop import Shop
from app.models.stock_movement import StockMovement
from app.models.stock_schedule import ScheduleStatus, StockSchedule
from app.providers.base import OrderDetail, OrderItemDetail
from app.providers.manual_ec import ManualECProvider
from app.providers.test_items import TEST_ITEMS
from app.services.order_ingestion_service import IngestionResult, OrderIngestionService

DEMO_MARKER_SKU = "DEMO-NUT-M3"

_PART_SKUS = {
    "nut": "DEMO-NUT-M3",
    "screw": "DEMO-SCR-M3-8",
    "sensor": "DEMO-SENSOR-TB",
    "case_black": "DEMO-CASE-BLACK",
    "case_white": "DEMO-CASE-WHITE",
    "keyswitch": "DEMO-KEYSWITCH",
    "hex_wrench": "DEMO-TOOL-HEX",
}
_ASSEMBLY_SKUS = {
    "trackball_unit": "DEMO-ASM-TB",
    "controller_unit": "DEMO-ASM-CTRL",
    "norecipe_unit": "DEMO-ASM-NORECIPE",
}


def _make_order(shop_id: int, unique_key: str, status: str, ordered_at: datetime) -> Order:
    return Order(
        shop_id=shop_id,
        platform="base",
        unique_key=unique_key,
        dispatch_status=status,
        ordered_at=ordered_at,
        last_name="デモ",
        first_name="太郎",
        prefecture="東京都",
        address="千代田区丸の内",  # 保持方針(town名レベルまで)に合わせ、番地以降は含めない
        email="demo@example.com",
    )


async def is_demo_data_seeded(session: AsyncSession) -> bool:
    result = await session.execute(select(Part).where(Part.sku == DEMO_MARKER_SKU))
    return result.scalars().first() is not None


async def _seed_shared_demo_master(session: AsyncSession) -> tuple[dict[str, Part], dict[str, Assembly]] | None:
    """部品/中間品マスタ、発注管理、見た目のための消費履歴、業務イベントログなど
    ショップに依存しない共有デモデータを投入する。既に投入済みなら何もせずNoneを返す。
    新規投入した場合は、BOM/注文投入で使うPart/Assemblyをキー名→オブジェクトの
    辞書で返す(キー名は_PART_SKUS/_ASSEMBLY_SKUSと対応)。"""
    if await is_demo_data_seeded(session):
        return None

    now = datetime.now(timezone.utc)

    # --- 部品マスタ ---
    nut = Part(
        name="ナット M3", sku="DEMO-NUT-M3", stock=500, reserved=0, unit_cost=5,
        tags=["ネジ類", "デモ"], group="M3ナット",
    )
    screw = Part(
        # 990 = 1000 - 10(トラックボールユニットの組立履歴5個分、レシピ2個/個)
        name="ネジ M3x8", sku="DEMO-SCR-M3-8", stock=990, reserved=0, unit_cost=3,
        tags=["ネジ類", "デモ"], group="M3ネジ", reorder_threshold=200,
    )
    sensor = Part(
        # 15 = 20 - 5(トラックボールユニットの組立履歴5個分、レシピ1個/個)
        name="トラックボールセンサー基板", sku="DEMO-SENSOR-TB", stock=15, reserved=0, unit_cost=800,
        tags=["電子部品", "デモ"], purchase_url="https://example.com/demo-sensor", reorder_threshold=5,
    )
    case_black = Part(
        name="ケースパーツ(ブラック)", sku="DEMO-CASE-BLACK", stock=8, reserved=0, unit_cost=1200,
        tags=["3Dプリント", "デモ"], colors=["ブラック"], reorder_threshold=10,  # 在庫<発注点、ダッシュボードの発注アラート例
    )
    case_white = Part(
        name="ケースパーツ(ホワイト)", sku="DEMO-CASE-WHITE", stock=15, reserved=0, unit_cost=1200,
        tags=["3Dプリント", "デモ"], colors=["ホワイト"], reorder_threshold=10,
        purchasable=False,  # 自社3Dプリント品(外部発注しない)の例。発注アラートの対象外
    )
    keyswitch = Part(
        name="キースイッチ", sku="DEMO-KEYSWITCH", stock=300, reserved=0, unit_cost=45,
        tags=["電子部品", "デモ"], group="スイッチ", colors=["クリア", "スモーク"], reorder_threshold=50,
    )
    hex_wrench = Part(
        # マイナス在庫の例(reorder_thresholdは意図的に未設定=発注アラートの対象外にし、
        # 「発注が必要」と「マイナス在庫」が別の独立したシグナルであることを示す)
        name="六角レンチ", sku="DEMO-TOOL-HEX", stock=-3, reserved=0, unit_cost=200,
        tags=["工具", "デモ"], group="工具",
    )
    session.add_all([nut, screw, sensor, case_black, case_white, keyswitch, hex_wrench])
    await session.flush()

    session.add(
        StockMovement(
            part_id=hex_wrench.id, quantity=-3, reason="manual_edit",
            note="デモ: 棚卸で実在庫と記録がズレた例", created_at=now - timedelta(days=6),
        )
    )

    # --- 中間品マスタ(組立品) + 組成 + 組立履歴 ---
    trackball_unit = Assembly(
        name="トラックボールユニット(組立済み)", sku="DEMO-ASM-TB", stock=3, reserved=0,
        unit_cost=900, tags=["デモ"],
    )
    controller_unit = Assembly(
        # 中間品が別の中間品を材料にする、多段構成の例(トラックボールユニット + キースイッチ)
        name="コントローラーユニット(組立済み)", sku="DEMO-ASM-CTRL", stock=2, reserved=0,
        unit_cost=2200, tags=["デモ"],
    )
    norecipe_unit = Assembly(
        # レシピ未設定の中間品の例。レシピがあれば不足分は材料(部品/下位中間品)まで
        # 自動的に遡って引き当てられるが、レシピが無いとそれ以上遡れない。この状態は
        # 「BOM未設定」と同じ性質の一時的な未解決状態として扱う方針(2026-08-30決定)のため、
        # 部品のように在庫を超過して引き当てることはせず、この商品の引当ごとスキップして
        # 次回同期時に再試行する(reservation_skippedイベントログが記録される)
        name="基板ユニット(レシピ未設定)", sku="DEMO-ASM-NORECIPE", stock=1, reserved=0, tags=["デモ"],
    )
    session.add_all([trackball_unit, controller_unit, norecipe_unit])
    await session.flush()
    session.add_all([
        AssemblyItem(assembly_id=trackball_unit.id, material_part_id=sensor.id, quantity=1),
        AssemblyItem(assembly_id=trackball_unit.id, material_part_id=screw.id, quantity=2),
        AssemblyItem(assembly_id=controller_unit.id, material_assembly_id=trackball_unit.id, quantity=1),
        AssemblyItem(assembly_id=controller_unit.id, material_part_id=keyswitch.id, quantity=4),
    ])
    # 組立履歴(実際の組立操作は経由せず、ダッシュボードの「中間品組立稼働状況」グラフに
    # 複数日の推移が出るよう見た目のためのstock_movementsを直接投入する)
    session.add_all([
        StockMovement(
            assembly_id=trackball_unit.id, quantity=5, reason="assembly_build", note="初回組立",
            created_at=now - timedelta(days=13),
        ),
        StockMovement(
            assembly_id=trackball_unit.id, quantity=-2, reason="manual_edit", note="検品で2個破損",
            created_at=now - timedelta(days=11),
        ),
        StockMovement(
            assembly_id=trackball_unit.id, quantity=3, reason="assembly_build", note="追加組立",
            created_at=now - timedelta(days=6),
        ),
        StockMovement(
            assembly_id=controller_unit.id, quantity=2, reason="assembly_build", note="初回組立",
            created_at=now - timedelta(days=4),
        ),
        StockMovement(
            assembly_id=controller_unit.id, quantity=1, reason="assembly_build", note="追加組立",
            created_at=now - timedelta(days=1),
        ),
    ])

    # --- 見た目のための追加消費履歴(ダッシュボードの部品消費トレンドグラフが複数日・
    # 複数部品にわたる推移として見えるよう、実注文とは独立に直接投入する) ---
    session.add_all([
        StockMovement(part_id=nut.id, quantity=-8, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=12)),
        StockMovement(part_id=keyswitch.id, quantity=-4, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=10)),
        StockMovement(part_id=screw.id, quantity=-6, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=9)),
        StockMovement(part_id=nut.id, quantity=-4, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=7)),
        StockMovement(part_id=case_black.id, quantity=-2, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=5)),
        StockMovement(part_id=keyswitch.id, quantity=-6, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=3)),
        StockMovement(part_id=screw.id, quantity=-3, reason="order_consumed", note="デモ: 消費トレンド用",
                       created_at=now - timedelta(days=2)),
    ])

    # --- 業務イベントログ: 自然発生しないカテゴリをデモ用に直接投入する
    # (reservation_skippedは_seed_shop_scoped_demo_dataの注文D・B・E(基板ユニットの
    # レシピ未設定)で実際に記録される。assembly_stock_shortfallは2026-08-30の方針変更で
    # reservation_skippedに統合され、現在このコードパスからは発生しなくなった) ---
    session.add_all([
        EventLog(
            category="stock_operation_failed", level="error",
            message="デモ: 在庫更新中に一時的なデータベースエラーが発生しました(自動リトライで解消)",
            created_at=now - timedelta(hours=8),
        ),
        EventLog(
            category="retention_cleanup", level="info",
            message="デモ: 保持期間を過ぎた注文3件・発注1件を自動削除しました",
            created_at=now - timedelta(days=1),
        ),
        EventLog(
            category="auth_error", level="error",
            message="デモ: BASE連携のrefresh_tokenが失効しました。設定画面から再認証してください",
            created_at=now - timedelta(days=4),
        ),
    ])

    await session.commit()

    parts = {"nut": nut, "screw": screw, "sensor": sensor, "case_black": case_black,
              "case_white": case_white, "keyswitch": keyswitch, "hex_wrench": hex_wrench}
    assemblies = {"trackball_unit": trackball_unit, "controller_unit": controller_unit,
                  "norecipe_unit": norecipe_unit}
    return parts, assemblies


async def _get_demo_parts_and_assemblies(session: AsyncSession) -> tuple[dict[str, Part], dict[str, Assembly]]:
    """共有マスタが既に投入済みのとき、BOM/注文投入に使うPart/Assemblyを
    skuで検索して取得する(_seed_shared_demo_masterの戻り値と同じ形の辞書)。"""
    parts_result = await session.execute(select(Part).where(Part.sku.in_(_PART_SKUS.values())))
    parts_by_sku = {p.sku: p for p in parts_result.scalars()}
    parts = {key: parts_by_sku[sku] for key, sku in _PART_SKUS.items()}

    assemblies_result = await session.execute(select(Assembly).where(Assembly.sku.in_(_ASSEMBLY_SKUS.values())))
    assemblies_by_sku = {a.sku: a for a in assemblies_result.scalars()}
    assemblies = {key: assemblies_by_sku[sku] for key, sku in _ASSEMBLY_SKUS.items()}

    return parts, assemblies


async def _seed_sales_history(
    session: AsyncSession,
    shop: Shop,
    catalog: list[tuple[str, str, int, str, int, int]],
    unique_prefix: str,
) -> None:
    """売上ページのグラフ(推移・商品別ランキング・平均注文単価など)に厚みを持たせるための、
    過去75日分の発送済み注文をまとめて直接投入する。実際の引当ロジック(_reserve/
    _apply_stock_operation)は経由せず、部品/中間品の在庫には一切影響を与えない
    (ダッシュボードの「見た目のための」消費履歴と同じ考え方)。売上の原価集計
    (sales_service._compute_cost_by_order_item)はorder_part_reservationsの記録だけを見るため、
    実際の消費量をそのまま書き込めば粗利も正しく計算される。

    catalogは共通行のみ(単一の部品/中間品だけを消費する)のBOMを持つ商品に限定する
    (オプション/バリエーション条件の解決をここで再実装せずに済ませるため)。各要素は
    (item_id, item_name, price, component_type, material_id, quantity_per_unit)。
    """
    now = datetime.now(timezone.utc)
    for day_offset in range(75, 0, -1):
        day = now - timedelta(days=day_offset)
        is_weekend = day.weekday() >= 5
        weights = [2, 3, 3, 1, 0] if is_weekend else [1, 2, 4, 4, 2]
        order_count = random.choices([0, 1, 2, 3, 4], weights=weights)[0]

        for _ in range(order_count):
            item_id, item_name, price, component_type, material_id, quantity_per_unit = random.choice(catalog)
            quantity = random.randint(1, 3)
            total = price * quantity
            ordered_at = day.replace(hour=random.randint(8, 22), minute=random.randint(0, 59), second=0, microsecond=0)
            dispatched_at = ordered_at + timedelta(hours=random.randint(2, 30))

            order = Order(
                shop_id=shop.id, platform=shop.platform,
                unique_key=f"{unique_prefix}-{secrets.token_hex(4).upper()}",
                dispatch_status=DispatchStatus.DISPATCHED.value,
                ordered_at=ordered_at, dispatched_at=dispatched_at,
                items_fetched=True, stock_applied=True, total=total,
                last_name="デモ", first_name="花子", prefecture="東京都", address="渋谷区",
                email="demo-sales@example.com",
            )
            session.add(order)
            await session.flush()

            order_item = OrderItem(
                order_id=order.id, item_id=item_id, title=item_name,
                quantity=quantity, price=price, total=total, picked=True,
            )
            session.add(order_item)
            await session.flush()

            material_key = "part_id" if component_type == "part" else "assembly_id"
            session.add(OrderPartReservation(
                order_id=order.id, order_item_id=order_item.id,
                quantity=quantity * quantity_per_unit, applied=True,
                **{material_key: material_id},
            ))

    await session.commit()


async def _seed_shop_scoped_demo_data(
    session: AsyncSession, shop: Shop, parts: dict[str, Part], assemblies: dict[str, Assembly]
) -> None:
    """BOM/注文/在庫スケジュールなど、shop_idに紐づくデモデータをそのショップに
    投入する。部品/中間品マスタが新規投入・使い回しのどちらでも、呼ばれるたびに
    実行してよい(複数ショップぶん繰り返し呼べる)。"""
    now = datetime.now(timezone.utc)
    nut, screw, keyswitch = parts["nut"], parts["screw"], parts["keyswitch"]
    case_black, case_white = parts["case_black"], parts["case_white"]
    trackball_unit, norecipe_unit = assemblies["trackball_unit"], assemblies["norecipe_unit"]

    # --- BOM(商品レシピ): test-item-001に共通/オプション/種類/組み合わせの全条件パターンを用意 ---
    opt_right_trackball = "demo-opt-right-trackball"
    opt_right_keyswitch = "demo-opt-right-keyswitch"
    var_black = "demo-var-black"
    var_white = "demo-var-white"

    bom_common = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="part", part_id=nut.id, quantity=4)
    bom_norecipe = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="assembly", assembly_id=norecipe_unit.id, quantity=1)
    bom_opt_trackball = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="assembly", assembly_id=trackball_unit.id, quantity=1)
    bom_opt_keyswitch = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="part", part_id=keyswitch.id, quantity=1)
    bom_var_black = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="part", part_id=case_black.id, quantity=1)
    bom_var_white = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="part", part_id=case_white.id, quantity=1)
    bom_combo_black = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="part", part_id=screw.id, quantity=1)
    bom_combo_white = BomItem(shop_id=shop.id, item_id="test-item-001", item_name="テスト商品001", component_type="part", part_id=screw.id, quantity=1)
    session.add_all([
        bom_common, bom_norecipe, bom_opt_trackball, bom_opt_keyswitch, bom_var_black, bom_var_white,
        bom_combo_black, bom_combo_white,
    ])
    await session.flush()

    session.add_all([
        BomItemCondition(bom_item_id=bom_opt_trackball.id, selector_type="option", selector_id=opt_right_trackball, group_name="右モジュール", choice_name="トラックボール", group_order=0, choice_order=0),
        BomItemCondition(bom_item_id=bom_opt_keyswitch.id, selector_type="option", selector_id=opt_right_keyswitch, group_name="右モジュール", choice_name="キースイッチ", group_order=0, choice_order=1),
        BomItemCondition(bom_item_id=bom_var_black.id, selector_type="variation", selector_id=var_black, group_name="種類", choice_name="ブラック", choice_order=0),
        BomItemCondition(bom_item_id=bom_var_white.id, selector_type="variation", selector_id=var_white, group_name="種類", choice_name="ホワイト", choice_order=1),
        # 組み合わせ条件(2条件のAND): 「右モジュール=トラックボール」かつ「種類=◯◯」のときだけ追加のネジが要る、という例
        BomItemCondition(bom_item_id=bom_combo_black.id, selector_type="option", selector_id=opt_right_trackball, group_name="右モジュール", choice_name="トラックボール", group_order=0, choice_order=0),
        BomItemCondition(bom_item_id=bom_combo_black.id, selector_type="variation", selector_id=var_black, group_name="種類", choice_name="ブラック", choice_order=0),
        BomItemCondition(bom_item_id=bom_combo_white.id, selector_type="option", selector_id=opt_right_trackball, group_name="右モジュール", choice_name="トラックボール", group_order=0, choice_order=0),
        BomItemCondition(bom_item_id=bom_combo_white.id, selector_type="variation", selector_id=var_white, group_name="種類", choice_name="ホワイト", choice_order=1),
    ])

    # test-item-002は最もシンプルな「共通行のみ」のBOM例
    session.add(BomItem(shop_id=shop.id, item_id="test-item-002", item_name="テスト商品002", component_type="part", part_id=keyswitch.id, quantity=2))

    # test-item-004〜008: BOM一覧・ランダム注文補充のサンプル数を増やすための追加商品。
    # いずれも共通行のみのシンプルなBOM(既存の部品/中間品を使い回す)
    session.add_all([
        BomItem(shop_id=shop.id, item_id="test-item-004", item_name="テスト商品004", component_type="part", part_id=keyswitch.id, quantity=1),
        BomItem(shop_id=shop.id, item_id="test-item-005", item_name="テスト商品005", component_type="part", part_id=nut.id, quantity=2),
        BomItem(shop_id=shop.id, item_id="test-item-006", item_name="テスト商品006", component_type="part", part_id=case_black.id, quantity=1),
        BomItem(shop_id=shop.id, item_id="test-item-007", item_name="テスト商品007", component_type="part", part_id=screw.id, quantity=3),
        BomItem(shop_id=shop.id, item_id="test-item-008", item_name="テスト商品008", component_type="assembly", assembly_id=trackball_unit.id, quantity=1),
    ])

    # test-item-001は注文一覧PDF出力でオプションを横並びの表にする設定例(matrix_layout)
    session.add(BomProductSetting(shop_id=shop.id, item_id="test-item-001", matrix_layout=True))

    # test-item-009: BOMの「複製して新規作成」を練習するための複製元。オプション2グループ
    # (左モジュール・右モジュール)+バリエーション(カラー)を持たせ、名前が一致しない
    # 複製先(test-item-010/011。TEST_ITEM_VARIATIONS/TEST_ITEM_OPTIONS参照)へ複製する際に
    # 対応付けUI(軸レベル・選択肢レベルとも)を一通り試せるようにする。test-item-010/011
    # 自体にはBOMを登録しない(複製先候補はBOM登録済みの商品を除外する仕様のため、
    # 常に複製先として選べる状態を保つ)
    ITEM_009 = "test-item-009"
    ITEM_009_NAME = "テスト商品009(複製元・複製練習用)"
    opt_left_palmrest = "demo-opt-009-left-palmrest"
    opt_left_battery = "demo-opt-009-left-battery"
    opt_right_trackball_009 = "demo-opt-009-right-trackball"
    opt_right_keyswitch_009 = "demo-opt-009-right-keyswitch"
    var_red_009 = "demo-var-009-red"
    var_blue_009 = "demo-var-009-blue"

    bom_009_common = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="part", part_id=nut.id, quantity=1)
    bom_009_left_palmrest = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="part", part_id=parts["hex_wrench"].id, quantity=1)
    bom_009_left_battery = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="part", part_id=parts["sensor"].id, quantity=1)
    bom_009_right_trackball = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="assembly", assembly_id=trackball_unit.id, quantity=1)
    bom_009_right_keyswitch = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="part", part_id=keyswitch.id, quantity=1)
    bom_009_red = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="part", part_id=case_black.id, quantity=1)
    bom_009_blue = BomItem(shop_id=shop.id, item_id=ITEM_009, item_name=ITEM_009_NAME, component_type="part", part_id=case_white.id, quantity=1)
    session.add_all([
        bom_009_common, bom_009_left_palmrest, bom_009_left_battery,
        bom_009_right_trackball, bom_009_right_keyswitch, bom_009_red, bom_009_blue,
    ])
    await session.flush()
    session.add_all([
        BomItemCondition(bom_item_id=bom_009_left_palmrest.id, selector_type="option", selector_id=opt_left_palmrest, group_name="左モジュール", choice_name="パームレスト", group_order=0, choice_order=0),
        BomItemCondition(bom_item_id=bom_009_left_battery.id, selector_type="option", selector_id=opt_left_battery, group_name="左モジュール", choice_name="拡張バッテリー", group_order=0, choice_order=1),
        BomItemCondition(bom_item_id=bom_009_right_trackball.id, selector_type="option", selector_id=opt_right_trackball_009, group_name="右モジュール", choice_name="トラックボール", group_order=1, choice_order=0),
        BomItemCondition(bom_item_id=bom_009_right_keyswitch.id, selector_type="option", selector_id=opt_right_keyswitch_009, group_name="右モジュール", choice_name="キースイッチ", group_order=1, choice_order=1),
        BomItemCondition(bom_item_id=bom_009_red.id, selector_type="variation", selector_id=var_red_009, group_name="カラー", choice_name="レッド", choice_order=0),
        BomItemCondition(bom_item_id=bom_009_blue.id, selector_type="variation", selector_id=var_blue_009, group_name="カラー", choice_name="ブルー", choice_order=1),
    ])

    await session.commit()

    # --- 注文: 実際の引当/消費/解放ロジック(OrderIngestionService)を通して整合性を保証する ---
    service = OrderIngestionService(session=session, provider=None, shop_id=shop.id)

    # 注文A: 発送済み(種類=ブラック, 右モジュール=トラックボール → 組み合わせ条件も適用される)
    order_a = _make_order(shop.id, "DEMO-ORDER-A-DISPATCHED", DispatchStatus.ORDERED.value, now - timedelta(days=5))
    session.add(order_a)
    await session.flush()
    oi_a = OrderItem(order_id=order_a.id, item_id="test-item-001", title="テスト商品001", quantity=1, price=15000, variation_id=var_black, variation="ブラック")
    session.add(oi_a)
    await session.flush()
    session.add(OrderItemOption(order_item_id=oi_a.id, option_id="demo-opt-right", option_variation_id=opt_right_trackball, option_name="右モジュール", option_value="トラックボール", sort_order=0))
    await session.commit()
    await service._reserve(order_a)
    order_a.dispatch_status = DispatchStatus.DISPATCHED.value
    order_a.dispatched_at = now - timedelta(days=1)
    order_a.stock_applied = False
    await session.commit()
    await service._apply_stock_operation(order_a, IngestionResult())
    # 発送時に生成された消費履歴(order_consumed)は、実行日時(投入日)のままだと
    # ダッシュボードの消費トレンドグラフが1点だけになるため、発送日時に合わせて遡らせる
    await session.execute(
        update(StockMovement)
        .where(StockMovement.order_id == order_a.id, StockMovement.reason == "order_consumed")
        .values(created_at=order_a.dispatched_at)
    )
    await session.commit()

    # 注文B: 未対応・未着手(種類=ホワイト, 右モジュール=キースイッチ → 組み合わせ条件には該当しない)
    order_b = _make_order(shop.id, "DEMO-ORDER-B-ORDERED", DispatchStatus.ORDERED.value, now - timedelta(hours=6))
    session.add(order_b)
    await session.flush()
    oi_b = OrderItem(order_id=order_b.id, item_id="test-item-001", title="テスト商品001", quantity=1, price=13000, variation_id=var_white, variation="ホワイト")
    session.add(oi_b)
    await session.flush()
    session.add(OrderItemOption(order_item_id=oi_b.id, option_id="demo-opt-right", option_variation_id=opt_right_keyswitch, option_name="右モジュール", option_value="キースイッチ", sort_order=0))
    await session.commit()
    await service._reserve(order_b)

    # 注文C: キャンセル済み(test-item-002、共通行のみのシンプルなBOM例)
    order_c = _make_order(shop.id, "DEMO-ORDER-C-CANCELLED", DispatchStatus.ORDERED.value, now - timedelta(days=3))
    session.add(order_c)
    await session.flush()
    session.add(OrderItem(order_id=order_c.id, item_id="test-item-002", title="テスト商品002", quantity=1, price=3000))
    await session.commit()
    await service._reserve(order_c)
    order_c.dispatch_status = DispatchStatus.CANCELLED.value
    order_c.cancelled_at = now - timedelta(days=2)
    order_c.stock_applied = False
    await session.commit()
    await service._apply_stock_operation(order_c, IngestionResult())

    # 注文D: 入金待ち(test-item-003、在庫0のテスト商品。BOM未設定のため引当はスキップされる例。
    # 実際に_reserve()を通すことで、reservation_skippedのイベントログも実際のロジックで記録される)
    order_d = _make_order(shop.id, "DEMO-ORDER-D-UNPAID", DispatchStatus.UNPAID.value, now - timedelta(hours=1))
    session.add(order_d)
    await session.flush()
    session.add(OrderItem(order_id=order_d.id, item_id="test-item-003", title="テスト商品003", quantity=2, price=2000))
    await session.commit()
    await service._reserve(order_d)

    # 注文E: 未対応・一部ピッキング完了(横並び表商品(test-item-001)+通常カード商品(test-item-002)を
    # 同梱。注文一覧PDFで「他商品あり」の相互注記バッジを確認できる)
    order_e = _make_order(shop.id, "DEMO-ORDER-E-PARTIAL", DispatchStatus.ORDERED.value, now - timedelta(hours=3))
    session.add(order_e)
    await session.flush()
    oi_e1 = OrderItem(order_id=order_e.id, item_id="test-item-001", title="テスト商品001", quantity=1, price=13000, variation_id=var_white, variation="ホワイト")
    oi_e2 = OrderItem(order_id=order_e.id, item_id="test-item-002", title="テスト商品002", quantity=2, price=3000)
    session.add_all([oi_e1, oi_e2])
    await session.flush()
    session.add(OrderItemOption(order_item_id=oi_e1.id, option_id="demo-opt-right", option_variation_id=opt_right_keyswitch, option_name="右モジュール", option_value="キースイッチ", sort_order=0))
    await session.commit()
    await service._reserve(order_e)
    oi_e2.picked = True  # 2商品中1商品だけピッキング完了 → 「1/2完了」の進捗バッジ例
    await session.commit()

    # 注文F: 未対応・ピッキング完了済み(1商品のみですべて完了 → 「ピッキング完了」バッジ例)
    order_f = _make_order(shop.id, "DEMO-ORDER-F-PICKED", DispatchStatus.ORDERED.value, now - timedelta(hours=12))
    session.add(order_f)
    await session.flush()
    oi_f = OrderItem(order_id=order_f.id, item_id="test-item-002", title="テスト商品002", quantity=1, price=3000)
    session.add(oi_f)
    await session.commit()
    await service._reserve(order_f)
    oi_f.picked = True
    await session.commit()

    # 注文G・H: 発送準備中・発送不可(BASEのdispatch_statusバリエーションを注文一覧の
    # ステータスバッジで一通り確認できるようにする。ピッキング画面はordered限定表示のため
    # ここには出てこない)
    order_g = _make_order(shop.id, "DEMO-ORDER-G-SHIPPING", DispatchStatus.SHIPPING.value, now - timedelta(days=2))
    session.add(order_g)
    await session.flush()
    session.add(OrderItem(order_id=order_g.id, item_id="test-item-002", title="テスト商品002", quantity=1, price=3000))
    await session.commit()
    await service._reserve(order_g)

    order_h = _make_order(shop.id, "DEMO-ORDER-H-UNSHIPPABLE", DispatchStatus.UNSHIPPABLE.value, now - timedelta(days=7))
    session.add(order_h)
    await session.flush()
    session.add(OrderItem(order_id=order_h.id, item_id="test-item-002", title="テスト商品002", quantity=1, price=3000))
    await session.commit()
    await service._reserve(order_h)

    # --- 発注管理: 発注リードタイム分布グラフの全ビンを一通り埋める(shop_id必須のため
    # ショップごとに投入する) ---
    session.add_all([
        PurchaseOrder(
            shop_id=shop.id, part_id=parts["sensor"].id, quantity=30, status=PurchaseOrderStatus.ORDERED.value,
            ordered_at=now - timedelta(days=2), note="デモ: 未入荷の発注",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=keyswitch.id, quantity=100, status=PurchaseOrderStatus.CANCELLED.value,
            ordered_at=now - timedelta(days=9), note="デモ: キャンセル済みの発注",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=nut.id, quantity=200, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=21), received_at=now - timedelta(days=20),
            note="デモ: リードタイム1日(0-1日ビン)",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=screw.id, quantity=300, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=16), received_at=now - timedelta(days=13),
            note="デモ: リードタイム3日(2-3日ビン)",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=case_black.id, quantity=20, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=20), received_at=now - timedelta(days=15),
            note="デモ: リードタイム5日(4-7日ビン)",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=parts["sensor"].id, quantity=10, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=26), received_at=now - timedelta(days=16),
            note="デモ: リードタイム10日(8-14日ビン)",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=keyswitch.id, quantity=150, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=41), received_at=now - timedelta(days=21),
            note="デモ: リードタイム20日(15-30日ビン)",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=nut.id, quantity=500, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=61), received_at=now - timedelta(days=16),
            note="デモ: リードタイム45日(31日以上ビン)",
        ),
    ])

    # --- 在庫スケジューラー: pending/success/failedを一通り ---
    session.add_all([
        StockSchedule(
            shop_id=shop.id, platform="base", item_id="test-item-003", item_name="テスト商品003",
            target_stock=20, run_at=now + timedelta(days=1), status=ScheduleStatus.PENDING.value,
        ),
        StockSchedule(
            shop_id=shop.id, platform="base", item_id="test-item-002", item_name="テスト商品002",
            target_stock=50, run_at=now - timedelta(days=3), status=ScheduleStatus.SUCCESS.value,
            executed_at=now - timedelta(days=3), http_status=200,
        ),
        StockSchedule(
            shop_id=shop.id, platform="base", item_id="test-item-001", item_name="テスト商品001",
            target_stock=10, run_at=now - timedelta(days=1), status=ScheduleStatus.FAILED.value,
            executed_at=now - timedelta(days=1), http_status=500,
            result_message="デモ: BASE側APIエラー(在庫更新失敗)",
        ),
    ])

    # --- カテゴリ: デモモードはBASEへ通信しないため通常の同期(item_category_sync_scheduler)は
    # 空を返す(DemoECProvider.list_categories参照)。売上ページのカテゴリ別グラフに実データを
    # 見せるため、ここで直接投入する ---
    session.add_all([
        ItemCategory(shop_id=shop.id, item_id="test-item-001", category_id=1, category_name="キーボード本体"),
        ItemCategory(shop_id=shop.id, item_id="test-item-009", category_id=1, category_name="キーボード本体"),
        ItemCategory(shop_id=shop.id, item_id="test-item-002", category_id=2, category_name="周辺機器"),
        ItemCategory(shop_id=shop.id, item_id="test-item-004", category_id=2, category_name="周辺機器"),
        ItemCategory(shop_id=shop.id, item_id="test-item-008", category_id=2, category_name="周辺機器"),
        ItemCategory(shop_id=shop.id, item_id="test-item-005", category_id=3, category_name="パーツ単品"),
        ItemCategory(shop_id=shop.id, item_id="test-item-006", category_id=3, category_name="パーツ単品"),
        ItemCategory(shop_id=shop.id, item_id="test-item-007", category_id=3, category_name="パーツ単品"),
    ])

    await session.commit()

    # --- 売上ページのグラフ(推移・商品別ランキング等)向けの過去75日分の発送済み注文 ---
    await _seed_sales_history(
        session, shop,
        [
            ("test-item-002", "テスト商品002", 3000, "part", keyswitch.id, 2),
            ("test-item-004", "テスト商品004", 2500, "part", keyswitch.id, 1),
            ("test-item-005", "テスト商品005", 1200, "part", nut.id, 2),
            ("test-item-006", "テスト商品006", 4500, "part", case_black.id, 1),
            ("test-item-007", "テスト商品007", 1800, "part", screw.id, 3),
            ("test-item-008", "テスト商品008", 9800, "assembly", trackball_unit.id, 1),
        ],
        "DEMO-SALES",
    )


async def seed_demo_data_base(session: AsyncSession, shop: Shop) -> bool:
    """指定したBASEショップに対してデモデータを投入する。部品/中間品(共有マスタ)は
    初回のみ投入し、BOM/注文/在庫スケジュール(shop_id紐づき)はショップごとに
    毎回投入する。このショップに既にBOMが投入済みなら二重投入(unique_key等の
    重複エラー)を避けるため何もせずFalseを返す(CLIスクリプト・APIどちらから
    同じショップに対して繰り返し呼ばれても安全にする)。それ以外はTrueを返す
    (部品/中間品マスタが既存で使い回しただけの場合も、このショップ向けの
    BOM/注文自体は新規投入されるためTrue)。"""
    already_seeded = (
        await session.execute(select(BomItem.id).where(BomItem.shop_id == shop.id).limit(1))
    ).scalar_one_or_none() is not None
    if already_seeded:
        return False

    shared = await _seed_shared_demo_master(session)
    if shared is None:
        parts, assemblies = await _get_demo_parts_and_assemblies(session)
    else:
        parts, assemblies = shared

    await _seed_shop_scoped_demo_data(session, shop, parts, assemblies)
    return True


async def _seed_manual_shop_scoped_demo_data(
    session: AsyncSession, shop: Shop, parts: dict[str, Part], assemblies: dict[str, Assembly]
) -> None:
    """手動管理ショップ向けに、商品マスタ(ManualItem/ManualItemVariation)・BOM・注文の
    デモデータを投入する。BASEでは商品の実体を持たないためBOM/注文だけを投入すればよいが、
    手動ショップには商品マスタの永続化先が無いためここで自前に作る必要がある点、オプション
    機構が無く単一軸バリエーションのみである点、注文がordered→dispatched/cancelledの
    2状態にしか遷移しない点がBASE版(_seed_shop_scoped_demo_data)との違い。
    リストック予約(BASEの出品在庫を予約更新する機能)は手動ショップには存在しないため
    投入しない。
    """
    now = datetime.now(timezone.utc)
    nut, keyswitch = parts["nut"], parts["keyswitch"]
    case_black, case_white = parts["case_black"], parts["case_white"]
    trackball_unit = assemblies["trackball_unit"]

    # --- 商品マスタ + バリエーション ---
    item_variant = ManualItem(
        shop_id=shop.id, item_id="demo-manual-001", title="デモ商品001(バリエーションあり)",
        # バリエーションを持つ商品は本体(共通)価格を持たない設計のため、priceはNoneのまま
        price=None, stock=50, description="バリエーションごとに独立した価格を持てる例(BOOTH等の方式)。",
    )
    item_simple = ManualItem(
        shop_id=shop.id, item_id="demo-manual-002", title="デモ商品002(シンプル)", price=500, stock=100,
    )
    item_assembly = ManualItem(
        shop_id=shop.id, item_id="demo-manual-003", title="デモ商品003(中間品を使うBOM例)",
        price=8000, stock=10,
    )
    # BOMの「複製して新規作成」を練習するための複製先。デモ商品001(バリエーション名:
    # ブラック/ホワイト)とは異なる名前のバリエーションを持たせ、選択肢の対応付けUIを
    # 試せるようにする。あえてBOMを登録せず(複製先候補はBOM登録済みの商品を除外する
    # 仕様のため)、常に複製先として選べる状態を保つ
    item_duplicate_target = ManualItem(
        shop_id=shop.id, item_id="demo-manual-004", title="デモ商品004(複製練習用・BOM未登録)",
        price=None, stock=0,
    )
    session.add_all([item_variant, item_simple, item_assembly, item_duplicate_target])
    await session.flush()
    session.add_all([
        ManualItemVariation(shop_id=shop.id, item_id=item_duplicate_target.item_id, name="レッド", stock=0, sort_order=0),
        ManualItemVariation(shop_id=shop.id, item_id=item_duplicate_target.item_id, name="ブルー", stock=0, sort_order=1),
    ])

    # バリエーションごとに独立した価格を持つ例(本体へのフォールバックは無いため両方に
    # 明示的な価格を設定する)。BOM側は選ばれた種類に応じてケースパーツが変わる
    var_black = ManualItemVariation(
        shop_id=shop.id, item_id=item_variant.item_id, name="ブラック", price=3200, stock=20, sort_order=0,
    )
    var_white = ManualItemVariation(
        shop_id=shop.id, item_id=item_variant.item_id, name="ホワイト", price=3000, stock=30, sort_order=1,
    )
    session.add_all([var_black, var_white])
    await session.flush()

    # --- BOM: 共通行 + バリエーション条件行(オプション機構が無いためBASE版より単純) ---
    bom_common = BomItem(
        shop_id=shop.id, item_id=item_variant.item_id, item_name=item_variant.title,
        component_type="part", part_id=nut.id, quantity=2,
    )
    bom_var_black = BomItem(
        shop_id=shop.id, item_id=item_variant.item_id, item_name=item_variant.title,
        component_type="part", part_id=case_black.id, quantity=1,
    )
    bom_var_white = BomItem(
        shop_id=shop.id, item_id=item_variant.item_id, item_name=item_variant.title,
        component_type="part", part_id=case_white.id, quantity=1,
    )
    session.add_all([bom_common, bom_var_black, bom_var_white])
    await session.flush()
    session.add_all([
        BomItemCondition(
            bom_item_id=bom_var_black.id, selector_type="variation", selector_id=str(var_black.id),
            group_name="種類", choice_name="ブラック", choice_order=0,
        ),
        BomItemCondition(
            bom_item_id=bom_var_white.id, selector_type="variation", selector_id=str(var_white.id),
            group_name="種類", choice_name="ホワイト", choice_order=1,
        ),
    ])

    # デモ商品002は最もシンプルな「共通行のみ」の例、デモ商品003は中間品(組立品)を
    # 材料に使うBOM例(BASEのtest-item-008相当)
    session.add(BomItem(
        shop_id=shop.id, item_id=item_simple.item_id, item_name=item_simple.title,
        component_type="part", part_id=keyswitch.id, quantity=1,
    ))
    session.add(BomItem(
        shop_id=shop.id, item_id=item_assembly.item_id, item_name=item_assembly.title,
        component_type="assembly", assembly_id=trackball_unit.id, quantity=1,
    ))
    await session.commit()

    # --- 注文: 実際のManualECProvider/OrderIngestionServiceを通して投入する(手動フォーム
    # からの登録・発送確定/キャンセルと全く同じ経路を通ることで整合性を保証する) ---
    provider = ManualECProvider(session, shop.id)
    service = OrderIngestionService(session=session, provider=provider, shop_id=shop.id)

    def _detail(unique_key: str, ordered_at: datetime, items: list[OrderItemDetail]) -> OrderDetail:
        return OrderDetail(
            unique_key=unique_key, dispatch_status=DispatchStatus.ORDERED.value, ordered=ordered_at,
            dispatched=None, cancelled=None, modified=None,
            last_name="デモ", first_name="次郎", prefecture="大阪府", address="大阪市北区",
            email="demo-manual@example.com",
            total=sum(i.total or 0 for i in items), items=items,
        )

    # 注文A: 発送済み(バリエーション「ブラック」の独立価格3200円がそのまま使われる例)
    order_a = await service.ingest_manual_order(_detail(
        "DEMO-MANUAL-ORDER-A-DISPATCHED", now - timedelta(days=4),
        [OrderItemDetail(
            item_id=item_variant.item_id, title=item_variant.title, quantity=1, price=3200, total=3200,
            variation_id=str(var_black.id), variation="ブラック",
        )],
    ))
    await service.set_manual_dispatch_status(order_a, DispatchStatus.DISPATCHED.value)
    # 発送日時をデモらしく過去に遡らせ、それに伴う消費履歴(order_consumed)もダッシュボードの
    # 消費トレンドグラフに乗るよう合わせて遡らせる(BASE版の注文Aと同じ調整)
    order_a.dispatched_at = now - timedelta(days=1)
    await session.commit()
    await session.execute(
        update(StockMovement)
        .where(StockMovement.order_id == order_a.id, StockMovement.reason == "order_consumed")
        .values(created_at=order_a.dispatched_at)
    )
    await session.commit()

    # 注文B: 未対応・未着手(バリエーション「ホワイト」の独立価格3000円がそのまま使われる例)
    await service.ingest_manual_order(_detail(
        "DEMO-MANUAL-ORDER-B-ORDERED", now - timedelta(hours=5),
        [OrderItemDetail(
            item_id=item_variant.item_id, title=item_variant.title, quantity=1, price=3000, total=3000,
            variation_id=str(var_white.id), variation="ホワイト",
        )],
    ))

    # 注文C: キャンセル済み
    order_c = await service.ingest_manual_order(_detail(
        "DEMO-MANUAL-ORDER-C-CANCELLED", now - timedelta(days=2),
        [OrderItemDetail(item_id=item_simple.item_id, title=item_simple.title, quantity=1, price=500, total=500)],
    ))
    await service.set_manual_dispatch_status(order_c, DispatchStatus.CANCELLED.value)

    # 注文D: 未対応・一部ピッキング完了(2商品中1商品だけ完了 → 「1/2完了」の進捗バッジ例)
    order_d = await service.ingest_manual_order(_detail(
        "DEMO-MANUAL-ORDER-D-PARTIAL", now - timedelta(hours=2),
        [
            OrderItemDetail(
                item_id=item_variant.item_id, title=item_variant.title, quantity=1, price=3200, total=3200,
                variation_id=str(var_black.id), variation="ブラック",
            ),
            OrderItemDetail(item_id=item_simple.item_id, title=item_simple.title, quantity=2, price=500, total=1000),
        ],
    ))
    order_d_items = list((
        await session.execute(select(OrderItem).where(OrderItem.order_id == order_d.id).order_by(OrderItem.id))
    ).scalars().all())
    order_d_items[1].picked = True
    await session.commit()

    # 注文E: 未対応・ピッキング完了済み(中間品を使うBOM例の商品ですべて完了 → 「ピッキング完了」バッジ例)
    order_e = await service.ingest_manual_order(_detail(
        "DEMO-MANUAL-ORDER-E-PICKED", now - timedelta(hours=10),
        [OrderItemDetail(item_id=item_assembly.item_id, title=item_assembly.title, quantity=1, price=8000, total=8000)],
    ))
    order_e_items = list((
        await session.execute(select(OrderItem).where(OrderItem.order_id == order_e.id))
    ).scalars().all())
    order_e_items[0].picked = True
    await session.commit()

    # --- 発注管理: 手動ショップでも発注リードタイムの分布グラフを一通り確認できるようにする ---
    session.add_all([
        PurchaseOrder(
            shop_id=shop.id, part_id=parts["sensor"].id, quantity=15, status=PurchaseOrderStatus.ORDERED.value,
            ordered_at=now - timedelta(days=1), note="デモ: 未入荷の発注",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=case_black.id, quantity=20, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=18), received_at=now - timedelta(days=17),
            note="デモ: リードタイム1日(0-1日ビン)",
        ),
        PurchaseOrder(
            shop_id=shop.id, part_id=nut.id, quantity=300, status=PurchaseOrderStatus.RECEIVED.value,
            ordered_at=now - timedelta(days=30), received_at=now - timedelta(days=20),
            note="デモ: リードタイム10日(8-14日ビン)",
        ),
    ])
    await session.commit()

    # --- 売上ページのグラフ向けの過去75日分の発送済み注文(BASE版と同じ考え方) ---
    await _seed_sales_history(
        session, shop,
        [
            (item_simple.item_id, item_simple.title, 500, "part", keyswitch.id, 1),
            (item_assembly.item_id, item_assembly.title, 8000, "assembly", trackball_unit.id, 1),
        ],
        "DEMO-MANUAL-SALES",
    )


async def seed_demo_data_manual(session: AsyncSession, shop: Shop) -> bool:
    """指定した手動管理ショップにデモデータを投入する。部品/中間品(共有マスタ)はBASEと
    共用し、初回のみ投入する。このショップに既に商品(ManualItem)が投入済みなら二重投入を
    避けるため何もせずFalseを返す(seed_demo_data_baseと同じ冪等性の考え方)。
    """
    already_seeded = (
        await session.execute(select(ManualItem.item_id).where(ManualItem.shop_id == shop.id).limit(1))
    ).scalar_one_or_none() is not None
    if already_seeded:
        return False

    shared = await _seed_shared_demo_master(session)
    if shared is None:
        parts, assemblies = await _get_demo_parts_and_assemblies(session)
    else:
        parts, assemblies = shared

    await _seed_manual_shop_scoped_demo_data(session, shop, parts, assemblies)
    return True


_SEEDERS: dict[str, Callable[[AsyncSession, Shop], Awaitable[bool]]] = {
    "base": seed_demo_data_base,
    "manual": seed_demo_data_manual,
}


async def seed_demo_data_for_shop(session: AsyncSession, shop: Shop) -> bool:
    """shop.platformに対応するデモデータ投入関数があれば呼ぶ。未対応プラット
    フォームなら何もせずFalseを返す(現状SELECTABLE_PLATFORMSがBASEのみのため
    到達しない想定だが、将来のガードとして)。"""
    seeder = _SEEDERS.get(shop.platform)
    if seeder is None:
        return False
    return await seeder(session, shop)


# --- デモモード専用: 同期のたびに注文を進行させる ---
#
# デモモードはBASEへ実通信しないため(DemoECProvider.list_ordersは常に[]を返す)、
# 「今すぐ同期」を押しても本来の同期は何もしない。それだと発送確定→実際の在庫消費という
# UniStockの中心的な挙動を体験できないため、同期のたびに以下をデモ的に代行する
# (order_scheduler.run_sync_once_for_shopから、settings.demo_modeのときだけ呼ばれる)。
#
# 1. ピッキングが完了している(=全商品にチェックが付いた)未対応の注文を発送済みにし、
#    実際の在庫消費(OrderIngestionService._apply_stock_operation)を走らせる
# 2. その結果、未対応(dispatch_status=ordered)の注文が0件になったら、BOMからランダムに
#    選んだ商品でランダムな件数の新しい注文を補充する(件数もランダム)
#
# 手動管理ショップはBASEのようなポーリング対象そのものが存在せず(list_orders/get_order_detail
# は常に空を返す設計)、注文は元々ユーザー操作(フォーム/CSV)でしか増減しない。デモモードか
# どうかに関わらずその前提は変わらないため、この「同期の肩代わり」自体を手動ショップには
# 適用しない(item_id/platformがBASE固定([_make_order]/[TEST_ITEMS]参照)のため、そのまま
# 適用すると手動ショップにBASE用の商品IDを持つ偽注文が紛れ込んでしまう)。


async def advance_demo_orders(session: AsyncSession, shop: Shop, result: IngestionResult) -> None:
    if shop.platform != "base":
        return
    await _dispatch_fully_picked_demo_orders(session, shop, result)
    await _refill_demo_orders_if_empty(session, shop, result)


async def _dispatch_fully_picked_demo_orders(session: AsyncSession, shop: Shop, result: IngestionResult) -> None:
    """未対応(ordered)かつ商品が1件以上あり、その全商品がピッキング済みの注文を
    発送済みにする。実際の発送確定と同じ経路(_apply_stock_operation)を通すため、
    仮引当が実在庫の消費にきちんと変わる。"""
    has_items = exists().where(OrderItem.order_id == Order.id)
    has_unpicked_item = exists().where(and_(OrderItem.order_id == Order.id, OrderItem.picked.is_(False)))
    orders_result = await session.execute(
        select(Order).where(
            Order.shop_id == shop.id,
            Order.dispatch_status == DispatchStatus.ORDERED.value,
            has_items,
            ~has_unpicked_item,
        )
    )
    orders = list(orders_result.scalars().all())
    if not orders:
        return

    service = OrderIngestionService(session=session, provider=None, shop_id=shop.id)
    now = datetime.now(timezone.utc)
    for order in orders:
        order.dispatch_status = DispatchStatus.DISPATCHED.value
        order.dispatched_at = now
        order.stock_applied = False
        await session.commit()
        await service._apply_stock_operation(order, result)
        result.transitioned_orders += 1


async def _refill_demo_orders_if_empty(session: AsyncSession, shop: Shop, result: IngestionResult) -> None:
    """未対応(ordered)の注文が0件になったら、BOMからランダムに選んだ商品で
    新しい注文をランダムな件数(2〜5件)だけ補充する。"""
    remaining = (
        await session.execute(
            select(func.count())
            .select_from(Order)
            .where(Order.shop_id == shop.id, Order.dispatch_status == DispatchStatus.ORDERED.value)
        )
    ).scalar_one()
    if remaining > 0:
        return

    item_ids = list(TEST_ITEMS.keys())
    if not item_ids:
        return

    service = OrderIngestionService(session=session, provider=None, shop_id=shop.id)
    now = datetime.now(timezone.utc)

    for _ in range(random.randint(2, 5)):
        order = _make_order(
            shop.id,
            f"DEMO-ORDER-{secrets.token_hex(4).upper()}",
            DispatchStatus.ORDERED.value,
            now - timedelta(minutes=random.randint(1, 2880)),
        )
        session.add(order)
        await session.flush()

        for item_id in random.sample(item_ids, k=random.randint(1, min(2, len(item_ids)))):
            item = TEST_ITEMS[item_id]
            session.add(
                OrderItem(
                    order_id=order.id,
                    item_id=item.item_id,
                    title=item.title,
                    quantity=random.randint(1, 3),
                    price=random.randint(1000, 20000),
                )
            )
        await session.commit()
        await service._reserve(order)
        result.new_orders += 1


def has_demo_seeder(platform: str) -> bool:
    """フロントが「デモ用のサンプルデータを投入する」ボタン自体を出すべきか
    どうかの判定に使う。"""
    return platform in _SEEDERS
