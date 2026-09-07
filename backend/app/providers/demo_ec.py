from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem, BomItemCondition
from app.providers.base import (
    CategoryInfo,
    ECPlatform,
    IECProvider,
    ItemInfo,
    ItemOption,
    ItemOptionChoice,
    ItemUpdateResult,
    ItemVariation,
    OrderDetail,
    OrderSummary,
    StockUpdateResult,
)
from app.providers.test_items import TEST_ITEM_OPTIONS, TEST_ITEM_VARIATIONS, TEST_ITEMS

_UNORDERED = 2**31 - 1


class DemoECProvider(IECProvider):
    """デモモード(BASE非接続のスタンドアロン展示用)専用のプロバイダ。

    BASEへは一切通信せず、DBに投入済みのデモデータ(demo_seed_service)だけで
    完結させる。オプション/種類の選択肢は、BOM編集画面が実際に参照するのと
    同じbom_items/bom_item_conditionsから動的に組み立てる(固定フィクスチャを
    別途持つと、デモBOMを更新するたびに二重管理でズレる)。
    """

    platform = ECPlatform.BASE

    def __init__(self, session: AsyncSession):
        self._session = session

    async def _condition_rows(self, item_id: str, selector_type: str) -> list[BomItemCondition]:
        stmt = (
            select(BomItemCondition)
            .join(BomItem, BomItemCondition.bom_item_id == BomItem.id)
            .where(BomItem.item_id == item_id, BomItemCondition.selector_type == selector_type)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def update_stock(self, item_id: str, quantity: int) -> StockUpdateResult:
        return StockUpdateResult(
            success=True,
            platform=self.platform,
            item_id=item_id,
            requested_stock=quantity,
            http_status=200,
            response_body={"demo_mode": True},
        )

    async def get_item(self, item_id: str) -> ItemInfo | None:
        return TEST_ITEMS.get(item_id)

    async def list_items(self, limit: int = 50, offset: int = 0) -> list[ItemInfo]:
        return list(TEST_ITEMS.values())

    async def update_item_description(self, item_id: str, detail: str) -> ItemUpdateResult:
        return ItemUpdateResult(
            success=True,
            platform=self.platform,
            item_id=item_id,
            http_status=200,
            response_body={"demo_mode": True},
        )

    async def list_orders(
        self, start_ordered: datetime, end_ordered: datetime | None = None
    ) -> list[OrderSummary]:
        # デモ注文はdemo_seed_serviceで直接投入済みのため、追加で同期すべき新規注文は無い
        return []

    async def get_order_detail(self, unique_key: str) -> OrderDetail | None:
        return None

    async def get_item_options(self, item_id: str) -> list[ItemOption]:
        # BOM未登録でもBASE側では既にオプションが設定済み、という状態を再現する固定データ
        # (test_items.TEST_ITEM_OPTIONS参照)。BOM複製機能の練習用商品でのみ使う
        if item_id in TEST_ITEM_OPTIONS:
            return [
                ItemOption(
                    option_id=group_name,
                    option_name=group_name,
                    choices=[
                        ItemOptionChoice(option_variation_id=choice_id, variation_name=choice_name, price=0)
                        for choice_id, choice_name in choices
                    ],
                )
                for group_name, choices in TEST_ITEM_OPTIONS[item_id]
            ]

        rows = await self._condition_rows(item_id, "option")

        groups: dict[str, dict] = {}
        for c in rows:
            group_name = c.group_name or "?"
            group = groups.setdefault(group_name, {"order": _UNORDERED, "choices": {}})
            if c.group_order is not None:
                group["order"] = min(group["order"], c.group_order)
            group["choices"][c.selector_id] = (
                c.choice_order if c.choice_order is not None else _UNORDERED,
                c.choice_name or "?",
            )

        ordered_groups = sorted(groups.items(), key=lambda kv: kv[1]["order"])
        options: list[ItemOption] = []
        for group_name, group in ordered_groups:
            choices = sorted(group["choices"].items(), key=lambda kv: kv[1][0])
            options.append(
                ItemOption(
                    # BASEのoption_idに相当する安定したIDがデモデータには無いため、
                    # グループ名自体をキーとして使う(一覧画面側も同じくgroup_nameで
                    # グルーピングしているため、表示との整合性は保たれる)
                    option_id=group_name,
                    option_name=group_name,
                    choices=[
                        ItemOptionChoice(option_variation_id=selector_id, variation_name=choice_name, price=0)
                        for selector_id, (_, choice_name) in choices
                    ],
                )
            )
        return options

    async def get_item_variations(self, item_id: str) -> list[ItemVariation]:
        # get_item_optionsと同じく、BOM未登録でもBASE側では既にバリエーションが
        # 設定済み、という状態を再現する固定データ(test_items.TEST_ITEM_VARIATIONS参照)
        if item_id in TEST_ITEM_VARIATIONS:
            return [
                ItemVariation(variation_id=variation_id, variation_name=variation_name, stock=0)
                for variation_id, variation_name in TEST_ITEM_VARIATIONS[item_id]
            ]

        rows = await self._condition_rows(item_id, "variation")

        # 同じ選択肢(selector_id)が複数のBOM行(単独条件行・組み合わせ行)から
        # 重複して参照されるため、selector_idで一意化してから順序を確定する
        by_id: dict[str, tuple[int, str]] = {}
        for c in rows:
            order = c.choice_order if c.choice_order is not None else _UNORDERED
            existing = by_id.get(c.selector_id)
            if existing is None or order < existing[0]:
                by_id[c.selector_id] = (order, c.choice_name or "?")

        ordered = sorted(by_id.items(), key=lambda kv: kv[1][0])
        return [
            ItemVariation(variation_id=selector_id, variation_name=choice_name, stock=0)
            for selector_id, (_, choice_name) in ordered
        ]

    async def list_categories(self) -> list[CategoryInfo]:
        # デモモードはBASEへ一切通信しないため、カテゴリ機能も対象外(同期ジョブ自体が
        # デモモードでは起動しない。デモ商品にカテゴリ概念を持ち込むと二重管理になるため)
        return []

    async def get_item_categories(self, item_id: str) -> list[int]:
        return []
