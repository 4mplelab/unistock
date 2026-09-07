import csv
import io

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.bom import BomItem, BomItemCondition
from app.models.bom_product_setting import BomProductSetting
from app.models.part import Part
from app.schemas.bom import (
    BomConditionInput,
    BomImportResult,
    BomItemCreate,
    BomItemUpdate,
    BomReplaceLine,
    ItemBuildableCountRead,
)
from app.services.assembly_service import AssemblyService


class BomItemNotFoundError(Exception):
    pass


class DuplicateBomItemError(Exception):
    pass


NONE_COMPONENT_LABEL = "部品不要"


def _component_key(item: BomItem) -> tuple[str, int]:
    if item.part_id is not None:
        return ("part", item.part_id)
    if item.assembly_id is not None:
        return ("assembly", item.assembly_id)
    return ("none", 0)


def _condition_set(conditions: list[BomConditionInput]) -> frozenset[tuple[str, str]]:
    return frozenset((c.selector_type, c.selector_id) for c in conditions)


def _condition_set_from_models(conditions: list[BomItemCondition]) -> frozenset[tuple[str, str]]:
    return frozenset((c.selector_type, c.selector_id) for c in conditions)


def _encode_conditions_csv(conditions: list[BomItemCondition]) -> str:
    parts = [
        f"{c.selector_type}::{c.selector_id}::{c.group_name or ''}::{c.choice_name or ''}" for c in conditions
    ]
    return ";;".join(parts)


def _decode_conditions_csv(raw: str) -> list[BomConditionInput]:
    raw = (raw or "").strip()
    if not raw:
        return []
    conditions: list[BomConditionInput] = []
    for chunk in raw.split(";;"):
        chunk = chunk.strip()
        if not chunk:
            continue
        fields = chunk.split("::")
        if len(fields) < 2:
            raise ValueError(f"conditionsの形式が不正です: {chunk!r}")
        selector_type = fields[0]
        selector_id = fields[1]
        group_name = fields[2] if len(fields) > 2 and fields[2] else None
        choice_name = fields[3] if len(fields) > 3 and fields[3] else None
        if selector_type not in ("option", "variation"):
            raise ValueError(f"conditionsのselector_typeが不正です: {selector_type!r}")
        conditions.append(
            BomConditionInput(
                selector_type=selector_type,
                selector_id=selector_id,
                group_name=group_name,
                choice_name=choice_name,
            )
        )
    return conditions


class BomService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def _component_names(self, items: list[BomItem]) -> dict[tuple[str, int], str]:
        part_ids = [i.part_id for i in items if i.part_id is not None]
        assembly_ids = [i.assembly_id for i in items if i.assembly_id is not None]

        names: dict[tuple[str, int], str] = {("none", 0): NONE_COMPONENT_LABEL}
        if part_ids:
            result = await self._session.execute(select(Part.id, Part.name).where(Part.id.in_(part_ids)))
            for pid, name in result.all():
                names[("part", pid)] = name
        if assembly_ids:
            result = await self._session.execute(
                select(Assembly.id, Assembly.name).where(Assembly.id.in_(assembly_ids))
            )
            for aid, name in result.all():
                names[("assembly", aid)] = name
        return names

    async def list_bom_items(self, shop_id: int, item_id: str | None = None) -> list[tuple[BomItem, str]]:
        stmt = select(BomItem).where(BomItem.shop_id == shop_id)
        if item_id is not None:
            stmt = stmt.where(BomItem.item_id == item_id)
        stmt = stmt.order_by(BomItem.item_id)
        result = await self._session.execute(stmt)
        items = list(result.scalars().unique().all())
        names = await self._component_names(items)
        return [(item, names.get(_component_key(item), "-")) for item in items]

    async def list_bom_items_page(
        self, shop_id: int, search: str | None = None, limit: int = 20, offset: int = 0
    ) -> tuple[list[tuple[BomItem, str]], int]:
        """商品(item_id)単位でページングしたBOM一覧を返す。

        bom_itemsは「商品×条件組み合わせ×部品」のデカルト積で行数が増えるため、
        生の行に対してlimit/offsetを掛けると1商品の途中でページが分かれてしまう
        (グルーピング表示が壊れる)。そのため、まず検索条件に一致する商品(item_id)を
        distinctに絞り込んでからlimit/offsetを適用し、該当ページの商品に属する
        BOM行を全件まとめて返す。
        """
        id_stmt = select(BomItem.item_id, func.min(BomItem.item_name).label("item_name")).where(
            BomItem.shop_id == shop_id
        )
        if search:
            pattern = f"%{search}%"
            id_stmt = (
                id_stmt.outerjoin(Part, Part.id == BomItem.part_id)
                .outerjoin(Assembly, Assembly.id == BomItem.assembly_id)
                .where(
                    or_(
                        BomItem.item_id.ilike(pattern),
                        BomItem.item_name.ilike(pattern),
                        Part.name.ilike(pattern),
                        Assembly.name.ilike(pattern),
                    )
                )
            )
        id_stmt = id_stmt.group_by(BomItem.item_id)

        total = (
            await self._session.execute(select(func.count()).select_from(id_stmt.subquery()))
        ).scalar_one()

        id_stmt = id_stmt.order_by(BomItem.item_id).limit(limit).offset(offset)
        page_item_ids = [row[0] for row in (await self._session.execute(id_stmt)).all()]
        if not page_item_ids:
            return [], total

        items_result = await self._session.execute(
            select(BomItem)
            .where(BomItem.shop_id == shop_id, BomItem.item_id.in_(page_item_ids))
            .order_by(BomItem.item_id)
        )
        items = list(items_result.scalars().unique().all())
        names = await self._component_names(items)
        return [(item, names.get(_component_key(item), "-")) for item in items], total

    async def get_bom_for_item(self, shop_id: int, item_id: str) -> list[BomItem]:
        """指定ショップ(shop_id)の商品(item_id)のBOM行を返す。注文取り込み時の部品引当計算で使用する。

        item_idはショップごとに割り振られるため、shop_idと組み合わせて初めて一意になる
        (別ショップの同じitem_id文字列に誤って一致しないようにする)。
        """
        result = await self._session.execute(
            select(BomItem).where(BomItem.shop_id == shop_id, BomItem.item_id == item_id)
        )
        return list(result.scalars().unique().all())

    async def _find_duplicate(
        self, shop_id: int, item_id: str, component_type: str, part_id: int | None, assembly_id: int | None,
        condition_key: frozenset[tuple[str, str]], exclude_id: int | None = None,
    ) -> BomItem | None:
        stmt = select(BomItem).where(BomItem.shop_id == shop_id, BomItem.item_id == item_id)
        if component_type == "part":
            stmt = stmt.where(BomItem.part_id == part_id)
        elif component_type == "assembly":
            stmt = stmt.where(BomItem.assembly_id == assembly_id)
        else:
            stmt = stmt.where(BomItem.part_id.is_(None), BomItem.assembly_id.is_(None))
        result = await self._session.execute(stmt)
        for candidate in result.scalars().unique().all():
            if exclude_id is not None and candidate.id == exclude_id:
                continue
            if _condition_set_from_models(candidate.conditions) == condition_key:
                return candidate
        return None

    async def create_bom_item(self, shop_id: int, data: BomItemCreate) -> BomItem:
        condition_key = _condition_set(data.conditions)
        if len(condition_key) != len(data.conditions):
            raise DuplicateBomItemError("同じ条件(selector_type/selector_id)が複数指定されています")

        duplicate = await self._find_duplicate(
            shop_id, data.item_id, data.component_type, data.part_id, data.assembly_id, condition_key
        )
        if duplicate is not None:
            raise DuplicateBomItemError(
                f"item_id={data.item_id} component_type={data.component_type} "
                f"part_id={data.part_id} assembly_id={data.assembly_id} "
                f"の同じ条件の組み合わせは既にBOMに登録されています"
            )

        bom_item = BomItem(
            shop_id=shop_id,
            item_id=data.item_id,
            item_name=data.item_name,
            component_type=data.component_type,
            part_id=data.part_id,
            assembly_id=data.assembly_id,
            quantity=data.quantity,
            conditions=[
                BomItemCondition(
                    selector_type=c.selector_type,
                    selector_id=c.selector_id,
                    group_name=c.group_name,
                    choice_name=c.choice_name,
                    group_order=c.group_order,
                    choice_order=c.choice_order,
                )
                for c in data.conditions
            ],
        )
        self._session.add(bom_item)
        await self._session.commit()
        await self._session.refresh(bom_item, attribute_names=["conditions"])
        return bom_item

    async def update_bom_item(self, shop_id: int, bom_item_id: int, data: BomItemUpdate) -> BomItem:
        bom_item = await self._session.get(BomItem, bom_item_id)
        if bom_item is None or bom_item.shop_id != shop_id:
            raise BomItemNotFoundError(f"bom_item {bom_item_id} not found")
        bom_item.quantity = data.quantity
        await self._session.commit()
        await self._session.refresh(bom_item, attribute_names=["conditions"])
        return bom_item

    async def delete_bom_item(self, shop_id: int, bom_item_id: int) -> None:
        bom_item = await self._session.get(BomItem, bom_item_id)
        if bom_item is None or bom_item.shop_id != shop_id:
            raise BomItemNotFoundError(f"bom_item {bom_item_id} not found")
        await self._session.delete(bom_item)
        await self._session.commit()

    async def replace_bom_for_item(
        self, shop_id: int, item_id: str, item_name: str | None, lines: list[BomReplaceLine]
    ) -> list[BomItem]:
        """指定ショップ(shop_id)のitem_idの既存BOM行を全削除し、渡された行で置き換える(1トランザクション)。"""
        keys = []
        for line in lines:
            condition_key = _condition_set(line.conditions)
            if len(condition_key) != len(line.conditions):
                raise DuplicateBomItemError("同じ条件(selector_type/selector_id)が1行内に複数指定されています")
            keys.append((line.component_type, line.part_id, line.assembly_id, condition_key))
        if len(keys) != len(set(keys)):
            raise DuplicateBomItemError("同じ部品/中間品・同じ条件の組み合わせが複数行に指定されています")

        existing = await self._session.execute(
            select(BomItem).where(BomItem.shop_id == shop_id, BomItem.item_id == item_id)
        )
        for bom_item in existing.scalars().unique().all():
            await self._session.delete(bom_item)
        await self._session.flush()

        new_items = [
            BomItem(
                shop_id=shop_id,
                item_id=item_id,
                item_name=item_name,
                component_type=line.component_type,
                part_id=line.part_id,
                assembly_id=line.assembly_id,
                quantity=line.quantity,
                conditions=[
                    BomItemCondition(
                        selector_type=c.selector_type,
                        selector_id=c.selector_id,
                        group_name=c.group_name,
                        choice_name=c.choice_name,
                        group_order=c.group_order,
                        choice_order=c.choice_order,
                    )
                    for c in line.conditions
                ],
            )
            for line in lines
        ]
        self._session.add_all(new_items)
        await self._session.commit()
        for bom_item in new_items:
            await self._session.refresh(bom_item, attribute_names=["conditions"])
        return new_items

    async def export_csv(self, shop_id: int) -> str:
        result = await self._session.execute(
            select(BomItem).where(BomItem.shop_id == shop_id).order_by(BomItem.item_id)
        )
        items = list(result.scalars().unique().all())

        part_ids = [i.part_id for i in items if i.part_id is not None]
        assembly_ids = [i.assembly_id for i in items if i.assembly_id is not None]
        part_skus: dict[int, tuple[str, str | None]] = {}
        if part_ids:
            result = await self._session.execute(select(Part.id, Part.name, Part.sku).where(Part.id.in_(part_ids)))
            for pid, name, sku in result.all():
                part_skus[pid] = (name, sku)
        assembly_skus: dict[int, tuple[str, str | None]] = {}
        if assembly_ids:
            result = await self._session.execute(
                select(Assembly.id, Assembly.name, Assembly.sku).where(Assembly.id.in_(assembly_ids))
            )
            for aid, name, sku in result.all():
                assembly_skus[aid] = (name, sku)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "item_id",
                "item_name",
                "component_type",
                "component_sku",
                "component_name",
                "quantity",
                "conditions",
            ]
        )
        for bom_item in items:
            if bom_item.part_id is not None:
                name, sku = part_skus.get(bom_item.part_id, ("-", None))
            elif bom_item.assembly_id is not None:
                name, sku = assembly_skus.get(bom_item.assembly_id, ("-", None))
            else:
                name, sku = NONE_COMPONENT_LABEL, None
            writer.writerow(
                [
                    bom_item.item_id,
                    bom_item.item_name or "",
                    bom_item.component_type,
                    sku or "",
                    name,
                    bom_item.quantity,
                    _encode_conditions_csv(bom_item.conditions),
                ]
            )
        return output.getvalue()

    async def import_csv(self, shop_id: int, content: str) -> BomImportResult:
        reader = csv.DictReader(io.StringIO(content))
        created = 0
        updated = 0
        errors: list[str] = []

        for line_no, row in enumerate(reader, start=2):
            try:
                item_id = (row.get("item_id") or "").strip()
                if not item_id:
                    raise ValueError("item_idが空です")

                component_type = (row.get("component_type") or "part").strip()
                if component_type not in ("part", "assembly", "none"):
                    raise ValueError(
                        f"component_typeはpart/assembly/noneのいずれかで指定してください: {component_type!r}"
                    )

                quantity_raw = (row.get("quantity") or "").strip()
                if component_type == "none":
                    quantity = 1
                else:
                    try:
                        quantity = int(quantity_raw) if quantity_raw else 0
                    except ValueError as e:
                        raise ValueError(f"quantityは整数で指定してください: {quantity_raw!r}") from e
                    if quantity <= 0:
                        raise ValueError("quantityは1以上で指定してください")

                component_sku = (row.get("component_sku") or "").strip()
                component_name = (row.get("component_name") or "").strip()

                part_id: int | None = None
                assembly_id: int | None = None
                if component_type == "part":
                    part: Part | None = None
                    if component_sku:
                        result = await self._session.execute(select(Part).where(Part.sku == component_sku))
                        part = result.scalars().first()
                    if part is None and component_name:
                        result = await self._session.execute(select(Part).where(Part.name == component_name))
                        part = result.scalars().first()
                    if part is None:
                        raise ValueError(
                            f"部品が見つかりません(component_sku={component_sku!r}, component_name={component_name!r})"
                        )
                    part_id = part.id
                elif component_type == "assembly":
                    assembly: Assembly | None = None
                    if component_sku:
                        result = await self._session.execute(select(Assembly).where(Assembly.sku == component_sku))
                        assembly = result.scalars().first()
                    if assembly is None and component_name:
                        result = await self._session.execute(
                            select(Assembly).where(Assembly.name == component_name)
                        )
                        assembly = result.scalars().first()
                    if assembly is None:
                        raise ValueError(
                            f"中間品が見つかりません(component_sku={component_sku!r}, component_name={component_name!r})"
                        )
                    assembly_id = assembly.id

                item_name = (row.get("item_name") or "").strip() or None
                conditions = _decode_conditions_csv(row.get("conditions") or "")
                condition_key = _condition_set(conditions)
                if len(condition_key) != len(conditions):
                    raise ValueError("conditions内に同じ条件が複数指定されています")

                existing = await self._find_duplicate(
                    shop_id, item_id, component_type, part_id, assembly_id, condition_key
                )
                if existing is not None:
                    existing.quantity = quantity
                    if item_name:
                        existing.item_name = item_name
                    for existing_cond, new_cond in zip(existing.conditions, conditions):
                        if new_cond.group_name:
                            existing_cond.group_name = new_cond.group_name
                        if new_cond.choice_name:
                            existing_cond.choice_name = new_cond.choice_name
                    updated += 1
                else:
                    self._session.add(
                        BomItem(
                            shop_id=shop_id,
                            item_id=item_id,
                            item_name=item_name,
                            component_type=component_type,
                            part_id=part_id,
                            assembly_id=assembly_id,
                            quantity=quantity,
                            conditions=[
                                BomItemCondition(
                                    selector_type=c.selector_type,
                                    selector_id=c.selector_id,
                                    group_name=c.group_name,
                                    choice_name=c.choice_name,
                                )
                                for c in conditions
                            ],
                        )
                    )
                    created += 1
            except ValueError as e:
                errors.append(f"{line_no}行目: {e}")

        await self._session.commit()
        return BomImportResult(created=created, updated=updated, errors=errors)

    async def get_product_setting(self, shop_id: int, item_id: str) -> tuple[bool, int | None]:
        """ショップの商品(shop_id, item_id)のmatrix_layout/buildable_alert_threshold設定。
        行が無ければ(false, None)(通常のカード形式・作成可能数アラート無効)扱い。"""
        setting = await self._session.get(BomProductSetting, (shop_id, item_id))
        if setting is None:
            return False, None
        return setting.matrix_layout, setting.buildable_alert_threshold

    async def set_product_setting(
        self, shop_id: int, item_id: str, matrix_layout: bool, buildable_alert_threshold: int | None
    ) -> tuple[bool, int | None]:
        setting = await self._session.get(BomProductSetting, (shop_id, item_id))
        if setting:
            setting.matrix_layout = matrix_layout
            setting.buildable_alert_threshold = buildable_alert_threshold
        else:
            setting = BomProductSetting(
                shop_id=shop_id,
                item_id=item_id,
                matrix_layout=matrix_layout,
                buildable_alert_threshold=buildable_alert_threshold,
            )
            self._session.add(setting)
        await self._session.commit()
        return setting.matrix_layout, setting.buildable_alert_threshold

    async def get_matrix_layout_map(self, shop_id: int, item_ids: list[str]) -> dict[str, bool]:
        """複数商品分のmatrix_layoutを一括取得する(注文一覧PDF出力用)。"""
        if not item_ids:
            return {}
        result = await self._session.execute(
            select(BomProductSetting).where(
                BomProductSetting.shop_id == shop_id, BomProductSetting.item_id.in_(set(item_ids))
            )
        )
        return {s.item_id: s.matrix_layout for s in result.scalars().all()}

    async def get_buildable_alert_thresholds(self, shop_id: int) -> dict[str, int]:
        """作成可能数アラートの閾値が設定済みの商品だけを(item_id -> threshold)で返す
        (通知機能の状態ベースチェック用)。"""
        result = await self._session.execute(
            select(BomProductSetting.item_id, BomProductSetting.buildable_alert_threshold).where(
                BomProductSetting.shop_id == shop_id, BomProductSetting.buildable_alert_threshold.is_not(None)
            )
        )
        return {item_id: threshold for item_id, threshold in result.all()}

    async def compute_item_buildable_counts(self, shop_id: int) -> list[ItemBuildableCountRead]:
        """商品(item_id)ごとの作成可能数を算出する。フロントの`BomListPage.tsx`にある
        `computeBuildableCount`/`splitLines`と同じグルーピング(共通行/オプション選択肢/
        組み合わせセルごとに独立計算)をバックエンドに複製したもの(通知機能の
        「商品の作成可能数閾値割れ」検知用)。

        共通行+全オプション選択肢+全組み合わせセルの中の最小値を、その商品の代表的な
        作成可能数として返す(画面に表示されている個々の数値のうち最悪値を見れば、
        「この商品は今売れない組み合わせがある」ことが分かるため)。

        part/assemblyが見つからない行はスキップする(`AssemblyService.compute_buildable_available`
        の「見つからなければ0扱い」とは異なる挙動)。通知の数値がBOM一覧画面の表示と
        食い違うと混乱するため、画面に実際に表示される値と一致させることを優先する。
        """
        result = await self._session.execute(select(BomItem).where(BomItem.shop_id == shop_id))
        bom_items = list(result.scalars().all())
        if not bom_items:
            return []

        part_rows = (await self._session.execute(select(Part.id, Part.stock, Part.reserved))).all()
        part_available = {row.id: row.stock - row.reserved for row in part_rows}
        assembly_buildable = await AssemblyService(self._session).compute_buildable_available()

        lines_by_item: dict[str, list[BomItem]] = {}
        item_names: dict[str, str | None] = {}
        for bi in bom_items:
            lines_by_item.setdefault(bi.item_id, []).append(bi)
            if bi.item_name:
                item_names[bi.item_id] = bi.item_name

        results: list[ItemBuildableCountRead] = []
        for item_id, lines in lines_by_item.items():
            # 条件(BomItemCondition)の(selector_type, selector_id)集合が同じ行同士が
            # 「同時に消費される1つの組み合わせ」(共通行=条件0件、選択肢=1件、
            # 組み合わせ=2件以上)。フロントのsplitLinesが表示用にcommon/choice/comboへ
            # 分類するのに対応する、計算だけに必要な最小限のグルーピング
            groups: dict[frozenset, list[BomItem]] = {}
            for line in lines:
                key = frozenset((c.selector_type, c.selector_id) for c in line.conditions)
                groups.setdefault(key, []).append(line)

            overall: int | None = None
            for group_lines in groups.values():
                group_min: int | None = None
                for line in group_lines:
                    if line.component_type == "none":
                        continue
                    available = (
                        part_available.get(line.part_id)
                        if line.component_type == "part"
                        else assembly_buildable.get(line.assembly_id)
                    )
                    if available is None:
                        continue
                    buildable = available // line.quantity
                    group_min = buildable if group_min is None else min(group_min, buildable)
                if group_min is None:
                    continue
                group_min = max(0, group_min)
                overall = group_min if overall is None else min(overall, group_min)

            results.append(
                ItemBuildableCountRead(item_id=item_id, item_name=item_names.get(item_id), buildable=overall)
            )

        return results
