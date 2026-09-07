import csv
import io

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bom import BomItem
from app.models.part import Part
from app.models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from app.schemas.part import PartCreate, PartImportResult, PartUpdate
from app.services.stock_movement_service import record_part_movement

CSV_COLUMNS = [
    "id",
    "name",
    "sku",
    "stock",
    "unit_cost",
    "reorder_threshold",
    "purchase_url",
    "tags",
    "group",
    "colors",
    "purchasable",
    "memo",
]


class PartNotFoundError(Exception):
    pass


class PartInUseError(Exception):
    pass


class PartService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_parts(self) -> list[Part]:
        result = await self._session.execute(select(Part).order_by(Part.name))
        return list(result.scalars().all())

    async def get_part(self, part_id: int) -> Part:
        part = await self._session.get(Part, part_id)
        if part is None:
            raise PartNotFoundError(f"part {part_id} not found")
        return part

    async def get_ordered_quantities(self, part_ids: list[int]) -> dict[int, int]:
        """指定した部品それぞれの発注中(status=ordered)の発注数量合計を返す"""
        if not part_ids:
            return {}
        stmt = (
            select(PurchaseOrder.part_id, func.sum(PurchaseOrder.quantity))
            .where(
                PurchaseOrder.status == PurchaseOrderStatus.ORDERED.value,
                PurchaseOrder.part_id.in_(part_ids),
            )
            .group_by(PurchaseOrder.part_id)
        )
        result = await self._session.execute(stmt)
        return {part_id: total for part_id, total in result.all()}

    async def create_part(self, data: PartCreate) -> Part:
        part = Part(
            name=data.name,
            sku=data.sku,
            stock=data.stock,
            unit_cost=data.unit_cost,
            tags=data.tags,
            group=data.group,
            colors=data.colors,
            purchase_url=data.purchase_url,
            reorder_threshold=data.reorder_threshold,
            purchasable=data.purchasable,
            memo=data.memo,
        )
        self._session.add(part)
        await self._session.commit()
        await self._session.refresh(part)
        return part

    async def update_part(self, part_id: int, data: PartUpdate) -> Part:
        part = await self.get_part(part_id)
        stock_before = part.stock
        # exclude_unset=Trueで「リクエストに含まれていたキーだけ」を対象にする。
        # 値がNoneかどうかでは判定しない(フォームは空欄にした項目をnullとして明示的に
        # 送ってくるため、「未送信だから更新しない」と「nullを送って値をクリアしたい」を
        # 区別する必要がある。CSVインポート(import_csv)と同じ「空なら消す」挙動に揃える)
        fields = data.model_dump(exclude_unset=True)
        for key in (
            "name",
            "sku",
            "stock",
            "unit_cost",
            "tags",
            "group",
            "colors",
            "purchase_url",
            "reorder_threshold",
            "purchasable",
            "memo",
        ):
            if key in fields:
                setattr(part, key, fields[key])

        delta = part.stock - stock_before
        if delta != 0:
            await record_part_movement(
                self._session, part_id, delta, reason="manual_edit", note=data.note
            )

        await self._session.commit()
        await self._session.refresh(part)
        return part

    async def add_stock(self, part_id: int, quantity: int, note: str | None = None) -> Part:
        """発注を介さず、部品の在庫数を直接加算する(自社製造品の在庫補充や、発注管理が
        不要な単発の入荷に使う)。中間品の組立と同様、行ロックを取って安全に加算する。
        """
        result = await self._session.execute(select(Part).where(Part.id == part_id).with_for_update())
        part = result.scalars().one_or_none()
        if part is None:
            raise PartNotFoundError(f"part {part_id} not found")
        part.stock += quantity
        await record_part_movement(self._session, part_id, quantity, reason="add_stock", note=note)
        await self._session.commit()
        await self._session.refresh(part)
        return part

    async def delete_part(self, part_id: int) -> None:
        part = await self.get_part(part_id)
        result = await self._session.execute(select(BomItem).where(BomItem.part_id == part_id).limit(1))
        if result.scalars().first() is not None:
            raise PartInUseError(f"part {part_id} はBOMで使用中のため削除できません")
        await self._session.delete(part)
        await self._session.commit()

    async def export_csv(self) -> str:
        parts = await self.list_parts()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(CSV_COLUMNS)
        for p in parts:
            writer.writerow(
                [
                    p.id,
                    p.name,
                    p.sku or "",
                    p.stock,
                    p.unit_cost if p.unit_cost is not None else "",
                    p.reorder_threshold if p.reorder_threshold is not None else "",
                    p.purchase_url or "",
                    ";".join(p.tags) if p.tags else "",
                    p.group or "",
                    ";".join(p.colors) if p.colors else "",
                    "1" if p.purchasable else "0",
                    p.memo or "",
                ]
            )
        return output.getvalue()

    async def import_csv(self, content: str) -> PartImportResult:
        reader = csv.DictReader(io.StringIO(content))
        created = 0
        updated = 0
        errors: list[str] = []

        for line_no, row in enumerate(reader, start=2):
            try:
                part_kwargs = self._parse_import_row(row)
            except ValueError as e:
                errors.append(f"{line_no}行目: {e}")
                continue

            existing: Part | None = None
            if part_kwargs["sku"]:
                result = await self._session.execute(select(Part).where(Part.sku == part_kwargs["sku"]))
                existing = result.scalars().first()
            if existing is None:
                result = await self._session.execute(select(Part).where(Part.name == part_kwargs["name"]))
                existing = result.scalars().first()

            if existing is not None:
                for key, value in part_kwargs.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                self._session.add(Part(**part_kwargs))
                created += 1

        await self._session.commit()
        return PartImportResult(created=created, updated=updated, errors=errors)

    @staticmethod
    def _parse_import_row(row: dict[str, str]) -> dict:
        name = (row.get("name") or "").strip()
        if not name:
            raise ValueError("nameが空です")

        def parse_int(key: str) -> int | None:
            raw = (row.get(key) or "").strip()
            if not raw:
                return None
            try:
                return int(raw)
            except ValueError as e:
                raise ValueError(f"{key}は整数で指定してください: {raw!r}") from e

        stock = parse_int("stock") or 0
        tags_raw = (row.get("tags") or "").strip()
        # PartCreate/PartUpdateのtags上限(5個・各20文字)に合わせ、CSV由来のタグもここで切り詰める
        tags = [t.strip()[:20] for t in tags_raw.split(";") if t.strip()][:5] or None
        colors_raw = (row.get("colors") or "").strip()
        colors = [c.strip() for c in colors_raw.split(";") if c.strip()] or None
        # 旧フォーマットのCSV(purchasable列が無い)との互換のため、未指定はTrue扱い
        purchasable_raw = (row.get("purchasable") or "").strip()
        purchasable = purchasable_raw != "0"

        return {
            "name": name,
            "sku": (row.get("sku") or "").strip() or None,
            "stock": stock,
            "unit_cost": parse_int("unit_cost"),
            "reorder_threshold": parse_int("reorder_threshold"),
            "purchase_url": (row.get("purchase_url") or "").strip() or None,
            "tags": tags,
            "group": (row.get("group") or "").strip() or None,
            "colors": colors,
            "purchasable": purchasable,
            "memo": (row.get("memo") or "").strip() or None,
        }
