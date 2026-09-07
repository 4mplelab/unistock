from app.providers.base import ItemInfo

TEST_ITEMS: dict[str, ItemInfo] = {
    "test-item-001": ItemInfo(item_id="test-item-001", title="テスト商品001", stock=10),
    "test-item-002": ItemInfo(item_id="test-item-002", title="テスト商品002", stock=5),
    "test-item-003": ItemInfo(item_id="test-item-003", title="テスト商品003", stock=0),
    # 004以降はBOM一覧・ランダム注文補充のサンプル数を増やすための追加商品(いずれも
    # 共通行のみのシンプルなBOM。demo_seed_service._seed_shop_scoped_demo_dataで
    # BOMを投入する)
    "test-item-004": ItemInfo(item_id="test-item-004", title="テスト商品004", stock=8),
    "test-item-005": ItemInfo(item_id="test-item-005", title="テスト商品005", stock=12),
    "test-item-006": ItemInfo(item_id="test-item-006", title="テスト商品006", stock=6),
    "test-item-007": ItemInfo(item_id="test-item-007", title="テスト商品007", stock=20),
    "test-item-008": ItemInfo(item_id="test-item-008", title="テスト商品008", stock=4),
    # 009〜011: 「BOMの複製して新規作成」を試すための商品。009は複製元(オプション2種類+
    # バリエーションを持つBOMをdemo_seed_serviceで投入する)、010・011はBOM未登録のまま
    # 複製先候補として残す(複製先候補はBOM登録済みの商品を除外する仕様のため)。
    # BASEは商品の実体を持たずオプション/バリエーションもBOM条件から動的に組み立てる
    # 関係上、「BOM未登録なのに独自のオプション/バリエーションを持つ商品」は本来
    # あり得ないが、実際のBASEショップでは商品ページのオプション設定がUniStockのBOM登録より
    # 先に存在するのが通常のため、TEST_ITEM_VARIATIONS/TEST_ITEM_OPTIONSで固定データとして
    # 用意し、その状態を疑似的に再現している(DemoECProvider参照)
    "test-item-009": ItemInfo(item_id="test-item-009", title="テスト商品009(複製元・複製練習用)", stock=15),
    "test-item-010": ItemInfo(item_id="test-item-010", title="テスト商品010(複製先・バリエーション名不一致)", stock=0),
    "test-item-011": ItemInfo(item_id="test-item-011", title="テスト商品011(複製先・オプション名不一致)", stock=0),
}

# BOMが未登録の商品でも、BASE側では既にオプション/バリエーションが設定済み、という
# 状態を再現するための固定データ。DemoECProvider.get_item_variationsが、該当item_idに
# ついてはBOM条件からの動的な組み立てより優先してこちらを返す
TEST_ITEM_VARIATIONS: dict[str, list[tuple[str, str]]] = {
    # (variation_id, variation_name)。test-item-009の「カラー」(レッド/ブルー)と
    # 選択肢名が一致しないため、複製時に選択肢の対応付け(プルダウン)を試せる
    "test-item-010": [("demo-color-red", "赤"), ("demo-color-blue", "青")],
}

TEST_ITEM_OPTIONS: dict[str, list[tuple[str, list[tuple[str, str]]]]] = {
    # (option_group_name, [(choice_id, choice_name), ...])。test-item-009の
    # 「左モジュール」「右モジュール」のどちらとも一致しない名前のオプショングループを
    # 1つだけ持たせ、複製時に軸自体の対応付け(候補2つから選ぶプルダウン)を試せる
    "test-item-011": [("サイドオプション", [("demo-side-a", "オプションA"), ("demo-side-b", "オプションB")])],
}
