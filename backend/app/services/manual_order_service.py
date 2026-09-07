import csv
import io
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_item import ManualItem
from app.models.manual_item_variation import ManualItemVariation
from app.models.order import DispatchStatus, Order
from app.providers.base import OrderDetail, OrderItemDetail
from app.providers.manual_ec import ManualECProvider
from app.schemas.manual_order import (
    ManualOrderCreate,
    ManualOrderCsvPreview,
    ManualOrderImportResult,
    ManualOrderItemCreate,
)
from app.schemas.manual_order_import_profile import ManualOrderCsvColumnMapping
from app.services.order_ingestion_service import OrderIngestionService

# マッピング未指定時のデフォルト(従来からのUniStock固定フォーマットと完全に一致させる)
_DEFAULT_MAPPING = ManualOrderCsvColumnMapping(
    order_ref="order_ref",
    ordered_at="ordered_at",
    last_name="last_name",
    first_name="first_name",
    prefecture="prefecture",
    address="address",
    email="email",
    item_id="item_id",
    quantity="quantity",
    variation_name="variation_name",
    price="price",
)

_PREVIEW_SAMPLE_ROWS = 3


class ManualOrderService:
    """外部連携APIを持たないショップ(ECPlatform.MANUAL)の注文を、フォーム/CSVから直接
    登録する。作成したOrderDetailは既存のOrderIngestionService.ingest_manual_order()に渡す
    だけで、部品引当・ピッキング等はBASEの注文と全く同じロジックで処理される。
    """

    def __init__(self, session: AsyncSession):
        self._session = session

    async def _get_manual_item(self, shop_id: int, item_id: str) -> ManualItem:
        item = await self._session.get(ManualItem, {"shop_id": shop_id, "item_id": item_id})
        if item is None:
            raise ValueError(f"商品 '{item_id}' が見つかりません")
        return item

    async def _resolve_variation_by_id(
        self, shop_id: int, item_id: str, variation_id: int | None
    ) -> ManualItemVariation | None:
        if variation_id is None:
            return None
        variation = await self._session.get(ManualItemVariation, variation_id)
        if variation is None or variation.shop_id != shop_id or variation.item_id != item_id:
            raise ValueError(f"バリエーション(id={variation_id})が見つかりません")
        return variation

    async def _resolve_variation_by_name(
        self, shop_id: int, item_id: str, name: str | None
    ) -> ManualItemVariation | None:
        if not name:
            return None
        stmt = select(ManualItemVariation).where(
            ManualItemVariation.shop_id == shop_id,
            ManualItemVariation.item_id == item_id,
            ManualItemVariation.name == name,
        )
        variation = (await self._session.execute(stmt)).scalars().first()
        if variation is None:
            raise ValueError(f"バリエーション '{name}' が商品 '{item_id}' に見つかりません")
        return variation

    async def _build_order_item_detail(self, shop_id: int, line: ManualOrderItemCreate) -> OrderItemDetail:
        if line.quantity <= 0:
            raise ValueError(f"数量は1以上を指定してください(item_id={line.item_id})")
        item = await self._get_manual_item(shop_id, line.item_id)
        variation = await self._resolve_variation_by_id(shop_id, line.item_id, line.variation_id)
        if variation is None and item.variations:
            # バリエーションを持つ商品は、必ずどれかのバリエーションを経由してのみ注文できる
            # (共通/本体の在庫が、バリエーションを介さず独立に売れているように見えてしまうのを避ける)
            raise ValueError(f"商品 '{item.item_id}' はバリエーションの選択が必要です")
        # バリエーションは本体価格への加算ではなく独立した価格を持つ(BOOTH等の方式に合わせる)。
        # バリエーションを持つ商品は本体(共通)価格を持たない設計のため、本体価格への
        # フォールバックはしない(バリエーション側の価格が未設定ならエラーにする)
        if line.price is not None:
            unit_price = line.price
        elif variation is not None:
            if variation.price is None:
                raise ValueError(f"「{item.title} / {variation.name}」の価格が設定されていません")
            unit_price = variation.price
        else:
            unit_price = item.price or 0
        return OrderItemDetail(
            item_id=item.item_id,
            title=item.title,
            quantity=line.quantity,
            price=unit_price,
            total=unit_price * line.quantity,
            variation_id=str(variation.id) if variation else None,
            variation=variation.name if variation else None,
        )

    async def _build_order_detail(self, shop_id: int, data: ManualOrderCreate, unique_key: str) -> OrderDetail:
        if not data.items:
            raise ValueError("商品を1件以上指定してください")
        item_details = [await self._build_order_item_detail(shop_id, line) for line in data.items]
        return OrderDetail(
            unique_key=unique_key,
            dispatch_status=DispatchStatus.ORDERED.value,
            ordered=data.ordered_at or datetime.now(timezone.utc),
            dispatched=None,
            cancelled=None,
            modified=None,
            last_name=data.last_name,
            first_name=data.first_name,
            prefecture=data.prefecture,
            address=data.address,
            email=data.email,
            total=sum(i.total or 0 for i in item_details),
            items=item_details,
        )

    async def create_order(self, shop_id: int, data: ManualOrderCreate) -> Order:
        detail = await self._build_order_detail(shop_id, data, f"manual-{uuid4().hex}")
        provider = ManualECProvider(self._session, shop_id)
        service = OrderIngestionService(self._session, provider, shop_id)
        return await service.ingest_manual_order(detail)

    async def update_order(self, shop_id: int, order: Order, data: ManualOrderCreate) -> Order:
        detail = await self._build_order_detail(shop_id, data, order.unique_key)
        provider = ManualECProvider(self._session, shop_id)
        service = OrderIngestionService(self._session, provider, shop_id)
        return await service.update_manual_order(order, detail)

    def _read_rows(self, text: str, has_header: bool) -> tuple[list[str], list[tuple[int, dict[str, str]]]]:
        """CSVを(列名一覧, [(元の行番号, 行の辞書), ...])に変換する。has_header=Falseの場合は
        1行目もデータ行として扱い、列名は「列1」「列2」...という合成名になる(1行目がヘッダーではなく
        データである可能性を考慮したオプション)。
        """
        raw_rows = list(csv.reader(io.StringIO(text)))
        if not raw_rows:
            return [], []

        if has_header:
            columns = raw_rows[0]
            data_rows = raw_rows[1:]
            start_line = 2
        else:
            width = max(len(r) for r in raw_rows)
            columns = [f"列{i + 1}" for i in range(width)]
            data_rows = raw_rows
            start_line = 1

        rows: list[tuple[int, dict[str, str]]] = []
        for i, raw_row in enumerate(data_rows):
            row = {col: (raw_row[j] if j < len(raw_row) else "") for j, col in enumerate(columns)}
            rows.append((start_line + i, row))
        return columns, rows

    def preview_csv(self, text: str, has_header: bool = True) -> ManualOrderCsvPreview:
        """CSVの列名と先頭数行を返す(列マッピングUIでのプレビュー用)。
        実際のインポート時と同じ_read_rowsで解釈するため、ここでの見え方と結果がずれない。
        """
        columns, rows = self._read_rows(text, has_header)
        sample_rows = [row for _, row in rows[:_PREVIEW_SAMPLE_ROWS]]
        return ManualOrderCsvPreview(columns=columns, sample_rows=sample_rows)

    async def import_csv(
        self,
        shop_id: int,
        text: str,
        mapping: ManualOrderCsvColumnMapping | None = None,
        has_header: bool = True,
    ) -> ManualOrderImportResult:
        """CSV(1行1商品明細)を取り込む。mapping未指定時は従来のUniStock固定フォーマット
        (order_ref,ordered_at,last_name,first_name,prefecture,address,email,item_id,
        quantity,variation_name,price)として読む。mapping.order_refが同じ行同士は
        1つの注文(複数商品)としてまとめる。空/未指定なら1行=1注文。
        """
        m = mapping or _DEFAULT_MAPPING
        _, all_rows = self._read_rows(text, has_header)

        groups: dict[str, list[tuple[int, dict]]] = {}
        group_order: list[str] = []
        for line_no, row in all_rows:
            key = ((row.get(m.order_ref) if m.order_ref else None) or "").strip() or f"__row_{line_no}__"
            groups.setdefault(key, []).append((line_no, row))
            if key not in group_order:
                group_order.append(key)

        created = 0
        errors: list[str] = []
        for key in group_order:
            rows = groups[key]
            first_line_no, first_row = rows[0]
            try:
                items: list[ManualOrderItemCreate] = []
                for _, row in rows:
                    item_id = (row.get(m.item_id) or "").strip()
                    if not item_id:
                        raise ValueError("item_idは必須です")
                    variation_name = ((row.get(m.variation_name) if m.variation_name else None) or "").strip() or None
                    variation = await self._resolve_variation_by_name(shop_id, item_id, variation_name)
                    price_raw = ((row.get(m.price) if m.price else None) or "").strip()
                    quantity_raw = ((row.get(m.quantity) if m.quantity else None) or "1").strip() or "1"
                    items.append(
                        ManualOrderItemCreate(
                            item_id=item_id,
                            quantity=int(quantity_raw),
                            variation_id=variation.id if variation else None,
                            price=int(price_raw) if price_raw else None,
                        )
                    )

                ordered_at_raw = ((first_row.get(m.ordered_at) if m.ordered_at else None) or "").strip()
                data = ManualOrderCreate(
                    ordered_at=datetime.fromisoformat(ordered_at_raw) if ordered_at_raw else None,
                    last_name=((first_row.get(m.last_name) if m.last_name else None) or "").strip() or None,
                    first_name=((first_row.get(m.first_name) if m.first_name else None) or "").strip() or None,
                    prefecture=((first_row.get(m.prefecture) if m.prefecture else None) or "").strip() or None,
                    address=((first_row.get(m.address) if m.address else None) or "").strip() or None,
                    email=((first_row.get(m.email) if m.email else None) or "").strip() or None,
                    items=items,
                )
                await self.create_order(shop_id, data)
                created += 1
            except (ValueError, KeyError) as e:
                errors.append(f"{first_line_no}行目: {e}")
                await self._session.rollback()

        return ManualOrderImportResult(created=created, errors=errors)
