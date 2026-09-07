from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class ECPlatform(str, Enum):
    BASE = "base"
    # 外部連携APIを持たないサイト向け。注文/商品はポーリングではなく手動フォーム・CSVで
    # 直接登録する(providers/manual_ec.py参照)
    MANUAL = "manual"


@dataclass
class StockUpdateResult:
    success: bool
    platform: ECPlatform
    item_id: str
    requested_stock: int
    http_status: int | None = None
    response_body: dict | None = None
    error_message: str | None = None


@dataclass
class ItemInfo:
    item_id: str
    title: str
    stock: int


@dataclass
class ItemUpdateResult:
    success: bool
    platform: ECPlatform
    item_id: str
    http_status: int | None = None
    response_body: dict | None = None
    error_message: str | None = None


@dataclass
class OrderSummary:
    unique_key: str
    ordered: datetime
    dispatched: datetime | None
    cancelled: datetime | None
    modified: datetime | None
    dispatch_status: str


@dataclass
class OrderItemOptionDetail:
    option_id: str
    option_variation_id: str
    option_name: str | None
    option_value: str | None
    # BASEの注文明細APIが返すoptions配列は表示順を保証しないため、商品側のlist_orderを
    # 突き合わせて解決した表示順(取得できない場合はNone)。
    sort_order: int | None = None


@dataclass
class OrderItemDetail:
    item_id: str
    title: str | None
    quantity: int
    price: int | None
    # 注文商品単位の合計金額(単価+オプション単価の合計を数量分)。取得できない場合はNone
    total: int | None = None
    # BASEの単一属性バリエーション(例: 色)。option_id等を持つ「options」とは別の仕組み。
    variation_id: str | None = None
    variation: str | None = None
    options: list[OrderItemOptionDetail] = field(default_factory=list)
    # BASEの注文明細行のstatus("ordered"/"cancelled"等)。注文全体のdispatch_statusとは独立
    status: str = "ordered"
    # BASEの注文明細行ID(order_items[].order_item_id)。再同期時の既存行との対応付けに使う
    order_item_id: str | None = None


@dataclass
class OrderDetail:
    unique_key: str
    dispatch_status: str
    # list_ordersのOrderSummaryと同じ日時項目。watermarkの範囲外に外れた注文でも
    # unique_key指定でこのAPIを個別に叩けば最新状態を確認できる(recheck_status参照)
    ordered: datetime
    dispatched: datetime | None
    cancelled: datetime | None
    modified: datetime | None
    last_name: str | None
    first_name: str | None
    prefecture: str | None
    address: str | None
    email: str | None
    # 注文合計金額(送料・代引き手数料・割引・調整額を含み、キャンセル済み商品は
    # 除外済み)。取得できない場合(プロバイダ未対応等)はNone
    total: int | None = None
    items: list[OrderItemDetail] = field(default_factory=list)


@dataclass
class ItemOptionChoice:
    option_variation_id: str
    variation_name: str
    price: int


@dataclass
class ItemOption:
    option_id: str
    option_name: str
    choices: list[ItemOptionChoice] = field(default_factory=list)


@dataclass
class ItemVariation:
    """BASEの単一属性バリエーション(例: 色)の1選択肢。optionsとは別の仕組み。"""

    variation_id: str
    variation_name: str
    stock: int


@dataclass
class CategoryInfo:
    category_id: int
    name: str


class ECProviderError(Exception):
    """プロバイダ共通の基底例外"""


class ECAuthError(ECProviderError):
    """refresh_token失効など、再認証が必要な致命的な認証エラー"""


class IECProvider(ABC):
    platform: ECPlatform

    @abstractmethod
    async def update_stock(self, item_id: str, quantity: int) -> StockUpdateResult:
        """在庫数を更新する。

        API側のバリデーションエラー(bad_item_id等)は例外を投げず
        StockUpdateResult(success=False, ...) として返す。
        再認証が必要な致命的な認証エラーのみ ECAuthError を送出する。
        """
        ...

    @abstractmethod
    async def get_item(self, item_id: str) -> ItemInfo | None:
        """商品を取得する。存在しない場合は None を返す。"""
        ...

    @abstractmethod
    async def list_items(self, limit: int = 50, offset: int = 0) -> list[ItemInfo]:
        """商品一覧を取得する。"""
        ...

    @abstractmethod
    async def update_item_description(self, item_id: str, detail: str) -> ItemUpdateResult:
        """商品説明(detail)を更新する。

        API側のバリデーションエラー(編集不可な商品タイプ等)は例外を投げず
        ItemUpdateResult(success=False, ...) として返す。
        再認証が必要な致命的な認証エラーのみ ECAuthError を送出する。
        """
        ...

    @abstractmethod
    async def list_orders(
        self, start_ordered: datetime, end_ordered: datetime | None = None
    ) -> list[OrderSummary]:
        """指定日時以降(注文日時基準)の注文一覧を取得する。ページネーションはこのメソッド内で吸収する。"""
        ...

    @abstractmethod
    async def get_order_detail(self, unique_key: str) -> OrderDetail | None:
        """注文の明細(商品明細・顧客情報)を取得する。存在しない場合は None を返す。"""
        ...

    @abstractmethod
    async def get_item_options(self, item_id: str) -> list[ItemOption]:
        """商品のオプション定義(オプショングループと選択肢)を取得する。オプションが無ければ空リスト。"""
        ...

    @abstractmethod
    async def get_item_variations(self, item_id: str) -> list[ItemVariation]:
        """商品の単一属性バリエーション定義(例: 色)を取得する。バリエーションが無ければ空リスト。"""
        ...

    @abstractmethod
    async def list_categories(self) -> list[CategoryInfo]:
        """ショップに登録されている商品カテゴリの一覧を取得する。"""
        ...

    @abstractmethod
    async def get_item_categories(self, item_id: str) -> list[int]:
        """商品が属するカテゴリIDの一覧を取得する。1商品が複数カテゴリに属する場合がある。
        カテゴリが未設定の商品は空リストを返す。"""
        ...
