import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings
from app.providers.base import (
    CategoryInfo,
    ECAuthError,
    ECPlatform,
    IECProvider,
    ItemInfo,
    ItemOption,
    ItemOptionChoice,
    ItemUpdateResult,
    ItemVariation,
    OrderDetail,
    OrderItemDetail,
    OrderItemOptionDetail,
    OrderSummary,
    StockUpdateResult,
)
from app.providers.test_items import TEST_ITEMS
from app.services.token_service import TokenRefreshError, TokenService

logger = logging.getLogger(__name__)

# BASE APIのstart_ordered/end_orderedはJSTの日時文字列として解釈される(実機確認済み、
# base-api-orders-real-response-verified参照)
_JST = timezone(timedelta(hours=9))


def _parse_epoch(value: int | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _format_jst(dt: datetime) -> str:
    return dt.astimezone(_JST).strftime("%Y-%m-%d %H:%M:%S")


class BaseECProvider(IECProvider):
    platform = ECPlatform.BASE

    def __init__(self, token_service: TokenService, client: httpx.AsyncClient | None = None):
        self._token_service = token_service
        self._client = client or httpx.AsyncClient(base_url=settings.base_api_base_url, timeout=10.0)

    async def update_stock(self, item_id: str, quantity: int) -> StockUpdateResult:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.post(
            "/1/items/edit_stock",
            data={"item_id": item_id, "stock": quantity},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        content_type = resp.headers.get("content-type", "")
        body = resp.json() if content_type.startswith("application/json") else {"raw": resp.text}
        success = resp.status_code == 200 and "item" in body

        return StockUpdateResult(
            success=success,
            platform=self.platform,
            item_id=item_id,
            requested_stock=quantity,
            http_status=resp.status_code,
            response_body=body,
            error_message=None if success else str(body.get("error", body)),
        )

    async def get_item(self, item_id: str) -> ItemInfo | None:
        if settings.demo_mode and item_id in TEST_ITEMS:
            return TEST_ITEMS[item_id]

        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.get(
            f"/1/items/detail/{item_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        if resp.status_code != 200 or body.get("error") == "no_item" or "item" not in body:
            return None

        item = body["item"]
        return ItemInfo(item_id=str(item["item_id"]), title=item["title"], stock=item["stock"])

    async def list_items(self, limit: int = 50, offset: int = 0) -> list[ItemInfo]:
        items = list(TEST_ITEMS.values()) if settings.demo_mode else []

        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError:
            # デモモードならBASE未認証でもテスト用商品だけで一覧UIの動作確認ができるように
            # する。通常モードで未認証の場合はitemsは空のまま返す(テスト商品を実データに
            # 混ぜない)
            return items

        try:
            resp = await self._client.get(
                "/1/items",
                params={"limit": limit, "offset": offset},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            body = resp.json()
            for raw in body.get("items", []):
                items.append(
                    ItemInfo(item_id=str(raw["item_id"]), title=raw["title"], stock=raw["stock"])
                )
        except (httpx.HTTPError, KeyError) as e:
            logger.warning("BASE商品一覧の取得に失敗しました: %s", e)

        return items

    async def update_item_description(self, item_id: str, detail: str) -> ItemUpdateResult:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.post(
            "/1/items/edit",
            data={"item_id": item_id, "detail": detail},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        content_type = resp.headers.get("content-type", "")
        body = resp.json() if content_type.startswith("application/json") else {"raw": resp.text}
        success = resp.status_code == 200 and "item" in body

        return ItemUpdateResult(
            success=success,
            platform=self.platform,
            item_id=item_id,
            http_status=resp.status_code,
            response_body=body,
            error_message=None if success else str(body.get("error", body)),
        )

    async def list_orders(
        self, start_ordered: datetime, end_ordered: datetime | None = None
    ) -> list[OrderSummary]:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        params: dict[str, str | int] = {"start_ordered": _format_jst(start_ordered)}
        if end_ordered is not None:
            params["end_ordered"] = _format_jst(end_ordered)

        summaries: list[OrderSummary] = []
        offset = 0
        limit = 100
        while True:
            resp = await self._client.get(
                "/1/orders",
                params={**params, "limit": limit, "offset": offset},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            body = resp.json()
            orders = body.get("orders", [])
            if not orders:
                break
            for raw in orders:
                summaries.append(
                    OrderSummary(
                        unique_key=raw["unique_key"],
                        ordered=_parse_epoch(raw["ordered"]),
                        dispatched=_parse_epoch(raw.get("dispatched")),
                        cancelled=_parse_epoch(raw.get("cancelled")),
                        modified=_parse_epoch(raw.get("modified")),
                        dispatch_status=raw["dispatch_status"],
                    )
                )
            if len(orders) < limit:
                break
            offset += limit

        return summaries

    async def get_order_detail(self, unique_key: str) -> OrderDetail | None:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.get(
            f"/1/orders/detail/{unique_key}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            return None
        body = resp.json()
        if "order" not in body:
            return None

        order = body["order"]
        raw_items = order.get("order_items", [])

        # BASEの注文明細APIが返すoptions配列は表示順を保証しない(実機確認済み)。商品側の
        # list_orderと突き合わせて表示順を解決するため、注文に含まれる商品ごとに1回だけ問い合わせる。
        option_order_maps: dict[str, dict[str, int]] = {}
        for iid in {str(raw["item_id"]) for raw in raw_items}:
            option_order_maps[iid] = await self._fetch_option_display_order(iid, access_token)

        items = []
        for raw in raw_items:
            item_id = str(raw["item_id"])
            order_map = option_order_maps.get(item_id, {})
            raw_options = sorted(
                raw.get("options", []),
                key=lambda opt: order_map.get(str(opt["option_variation_id"]), 10_000_000),
            )
            items.append(
                OrderItemDetail(
                    item_id=item_id,
                    title=raw.get("title"),
                    quantity=raw["amount"],
                    price=raw.get("price"),
                    total=raw.get("total"),
                    variation_id=str(raw["variation_id"]) if raw.get("variation_id") is not None else None,
                    variation=raw.get("variation"),
                    status=raw.get("status", "ordered"),
                    order_item_id=str(raw["order_item_id"]) if raw.get("order_item_id") is not None else None,
                    options=[
                        OrderItemOptionDetail(
                            option_id=str(opt["option_id"]),
                            option_variation_id=str(opt["option_variation_id"]),
                            option_name=opt.get("option_name"),
                            option_value=opt.get("option_value"),
                            sort_order=order_map.get(str(opt["option_variation_id"])),
                        )
                        for opt in raw_options
                    ],
                )
            )

        return OrderDetail(
            unique_key=order["unique_key"],
            dispatch_status=order["dispatch_status"],
            ordered=_parse_epoch(order["ordered"]),
            dispatched=_parse_epoch(order.get("dispatched")),
            cancelled=_parse_epoch(order.get("cancelled")),
            modified=_parse_epoch(order.get("modified")),
            last_name=order.get("last_name"),
            first_name=order.get("first_name"),
            prefecture=order.get("prefecture"),
            address=order.get("address"),
            email=order.get("mail_address"),
            total=order.get("total"),
            items=items,
        )

    async def _fetch_option_display_order(self, item_id: str, access_token: str) -> dict[str, int]:
        """item_idのオプション定義から option_variation_id -> 表示順(0始まり) の対応表を作る。

        get_order_detailが注文明細のoptions配列を並べ替えるために使う。商品が見つからない、
        または既にオプション構成が変わり選択肢が消えている場合はその分の対応が欠けるだけで
        エラーにはしない(呼び出し側はdictにない場合を「順序不明」として末尾扱いする)。
        """
        resp = await self._client.get(
            f"/1/items/detail/{item_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        if resp.status_code != 200 or body.get("error") == "no_item" or "item" not in body:
            return {}

        item = body["item"]
        raw_options = sorted(item.get("options", []), key=lambda o: o.get("list_order", 0))
        order_map: dict[str, int] = {}
        idx = 0
        for raw_opt in raw_options:
            raw_choices = sorted(
                raw_opt.get("select", {}).get("option_variations", []),
                key=lambda c: c.get("list_order", 0),
            )
            for choice in raw_choices:
                order_map[str(choice["option_variation_id"])] = idx
                idx += 1
        return order_map

    async def get_item_options(self, item_id: str) -> list[ItemOption]:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.get(
            f"/1/items/detail/{item_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        if resp.status_code != 200 or body.get("error") == "no_item" or "item" not in body:
            return []

        item = body["item"]
        options: list[ItemOption] = []
        # BASEはオプショングループ・選択肢それぞれにlist_orderを持つ。APIが返す配列の並びが
        # 常にlist_order順とは限らないため、明示的にソートしてBASEの表示順を保証する。
        raw_options = sorted(item.get("options", []), key=lambda o: o.get("list_order", 0))
        for raw_opt in raw_options:
            raw_choices = sorted(
                raw_opt.get("select", {}).get("option_variations", []),
                key=lambda c: c.get("list_order", 0),
            )
            choices = [
                ItemOptionChoice(
                    option_variation_id=str(choice["option_variation_id"]),
                    variation_name=choice["variation_name"],
                    price=choice.get("price", 0),
                )
                for choice in raw_choices
            ]
            options.append(
                ItemOption(
                    option_id=str(raw_opt["option_id"]),
                    option_name=raw_opt["option_name"],
                    choices=choices,
                )
            )
        return options

    async def get_item_variations(self, item_id: str) -> list[ItemVariation]:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.get(
            f"/1/items/detail/{item_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        if resp.status_code != 200 or body.get("error") == "no_item" or "item" not in body:
            return []

        item = body["item"]
        return [
            ItemVariation(
                variation_id=str(raw["variation_id"]),
                variation_name=raw["variation"],
                stock=raw.get("variation_stock", 0),
            )
            for raw in item.get("variations", [])
        ]

    async def list_categories(self) -> list[CategoryInfo]:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.get(
            "/1/categories",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        if resp.status_code != 200 or "categories" not in body:
            return []
        return [CategoryInfo(category_id=raw["category_id"], name=raw["name"]) for raw in body["categories"]]

    async def get_item_categories(self, item_id: str) -> list[int]:
        try:
            access_token = await self._token_service.get_valid_access_token()
        except TokenRefreshError as e:
            raise ECAuthError(str(e)) from e

        resp = await self._client.get(
            f"/1/item_categories/detail/{item_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        if resp.status_code != 200 or "item_categories" not in body:
            return []
        return [int(raw["category_id"]) for raw in body["item_categories"]]
