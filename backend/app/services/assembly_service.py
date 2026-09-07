import csv
import io

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.assembly_item import AssemblyItem
from app.models.bom import BomItem
from app.models.part import Part
from app.models.stock_movement import StockMovement
from app.schemas.assembly import (
    AssemblyCreate,
    AssemblyImportResult,
    AssemblyItemCreate,
    AssemblyUpdate,
)
from app.services.stock_movement_service import record_assembly_movement, record_part_movement

CSV_COLUMNS = ["id", "name", "sku", "stock", "unit_cost", "tags", "group", "memo"]


class AssemblyNotFoundError(Exception):
    pass


class AssemblyInUseError(Exception):
    pass


class CircularAssemblyReferenceError(Exception):
    pass


class DuplicateAssemblyItemError(Exception):
    pass


class AssemblyRecipeEmptyError(Exception):
    pass


class InsufficientMaterialStockError(Exception):
    pass


class AssemblyService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_assemblies(self) -> list[Assembly]:
        result = await self._session.execute(select(Assembly).order_by(Assembly.name))
        return list(result.scalars().all())

    async def get_assembly(self, assembly_id: int) -> Assembly:
        assembly = await self._session.get(Assembly, assembly_id)
        if assembly is None:
            raise AssemblyNotFoundError(f"assembly {assembly_id} not found")
        return assembly

    async def create_assembly(self, data: AssemblyCreate) -> Assembly:
        """中間品の作成と、渡された場合は組成(レシピ)の登録を1トランザクションでまとめて行う。"""
        assembly = Assembly(
            name=data.name,
            sku=data.sku,
            stock=data.stock,
            unit_cost=data.unit_cost,
            tags=data.tags,
            group=data.group,
            memo=data.memo,
        )
        self._session.add(assembly)
        await self._session.flush()

        if data.recipe:
            await self._apply_recipe(assembly.id, data.recipe)

        await self._session.commit()
        await self._session.refresh(assembly)
        return assembly

    async def update_assembly(self, assembly_id: int, data: AssemblyUpdate) -> Assembly:
        """中間品の更新と、指定された場合は組成(レシピ)の置き換えを1トランザクションでまとめて行う。"""
        assembly = await self.get_assembly(assembly_id)
        stock_before = assembly.stock
        # exclude_unset=Trueで「リクエストに含まれていたキーだけ」を対象にする(part_service.py
        # のupdate_partと同じ理由。フォームが空欄にした項目をnullとして明示的に送ってくるため、
        # 「未送信だから更新しない」と「nullを送って値をクリアしたい」を区別する必要がある)
        fields = data.model_dump(exclude_unset=True)
        for key in ("name", "sku", "stock", "unit_cost", "tags", "group", "memo"):
            if key in fields:
                setattr(assembly, key, fields[key])

        delta = assembly.stock - stock_before
        if delta != 0:
            await record_assembly_movement(
                self._session, assembly_id, delta, reason="manual_edit", note=data.note
            )

        if data.recipe is not None:
            await self._apply_recipe(assembly_id, data.recipe)

        await self._session.commit()
        await self._session.refresh(assembly)
        return assembly

    async def delete_assembly(self, assembly_id: int) -> None:
        assembly = await self.get_assembly(assembly_id)
        result = await self._session.execute(
            select(AssemblyItem).where(AssemblyItem.material_assembly_id == assembly_id).limit(1)
        )
        if result.scalars().first() is not None:
            raise AssemblyInUseError(f"assembly {assembly_id} は他の中間品のレシピで使用中のため削除できません")

        result = await self._session.execute(
            select(BomItem).where(BomItem.assembly_id == assembly_id).limit(1)
        )
        if result.scalars().first() is not None:
            raise AssemblyInUseError(f"assembly {assembly_id} はBOMで使用中のため削除できません")

        # 自身のレシピ行・組立履歴は他から参照されていないので一緒に削除する
        own_recipe = await self._session.execute(
            select(AssemblyItem).where(AssemblyItem.assembly_id == assembly_id)
        )
        for item in own_recipe.scalars().all():
            await self._session.delete(item)

        own_movements = await self._session.execute(
            select(StockMovement).where(StockMovement.assembly_id == assembly_id)
        )
        for movement in own_movements.scalars().all():
            await self._session.delete(movement)

        await self._session.flush()
        await self._session.delete(assembly)
        await self._session.commit()

    async def export_csv(self) -> str:
        assemblies = await self.list_assemblies()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(CSV_COLUMNS)
        for a in assemblies:
            writer.writerow(
                [
                    a.id,
                    a.name,
                    a.sku or "",
                    a.stock,
                    a.unit_cost if a.unit_cost is not None else "",
                    ";".join(a.tags) if a.tags else "",
                    a.group or "",
                    a.memo or "",
                ]
            )
        return output.getvalue()

    async def import_csv(self, content: str) -> AssemblyImportResult:
        reader = csv.DictReader(io.StringIO(content))
        created = 0
        updated = 0
        errors: list[str] = []

        for line_no, row in enumerate(reader, start=2):
            try:
                assembly_kwargs = self._parse_import_row(row)
            except ValueError as e:
                errors.append(f"{line_no}行目: {e}")
                continue

            existing: Assembly | None = None
            if assembly_kwargs["sku"]:
                result = await self._session.execute(
                    select(Assembly).where(Assembly.sku == assembly_kwargs["sku"])
                )
                existing = result.scalars().first()
            if existing is None:
                result = await self._session.execute(
                    select(Assembly).where(Assembly.name == assembly_kwargs["name"])
                )
                existing = result.scalars().first()

            if existing is not None:
                for key, value in assembly_kwargs.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                self._session.add(Assembly(**assembly_kwargs))
                created += 1

        await self._session.commit()
        return AssemblyImportResult(created=created, updated=updated, errors=errors)

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
        # AssemblyCreate/AssemblyUpdateのtags上限(5個・各20文字)に合わせ、CSV由来のタグもここで切り詰める
        tags = [t.strip()[:20] for t in tags_raw.split(";") if t.strip()][:5] or None

        return {
            "name": name,
            "sku": (row.get("sku") or "").strip() or None,
            "stock": stock,
            "unit_cost": parse_int("unit_cost"),
            "tags": tags,
            "group": (row.get("group") or "").strip() or None,
            "memo": (row.get("memo") or "").strip() or None,
        }

    # --- レシピ(組成) ---

    async def get_recipe_for_assembly(self, assembly_id: int) -> list[AssemblyItem]:
        result = await self._session.execute(
            select(AssemblyItem).where(AssemblyItem.assembly_id == assembly_id)
        )
        return list(result.scalars().all())

    async def list_recipe_with_names(self, assembly_id: int) -> list[tuple[AssemblyItem, str]]:
        items = await self.get_recipe_for_assembly(assembly_id)
        if not items:
            return []

        part_ids = [i.material_part_id for i in items if i.material_part_id is not None]
        assembly_ids = [i.material_assembly_id for i in items if i.material_assembly_id is not None]

        part_names: dict[int, str] = {}
        if part_ids:
            result = await self._session.execute(select(Part.id, Part.name).where(Part.id.in_(part_ids)))
            part_names = dict(result.all())

        assembly_names: dict[int, str] = {}
        if assembly_ids:
            result = await self._session.execute(
                select(Assembly.id, Assembly.name).where(Assembly.id.in_(assembly_ids))
            )
            assembly_names = dict(result.all())

        rows: list[tuple[AssemblyItem, str]] = []
        for item in items:
            if item.material_part_id is not None:
                rows.append((item, part_names.get(item.material_part_id, f"#{item.material_part_id}")))
            else:
                rows.append(
                    (item, assembly_names.get(item.material_assembly_id, f"#{item.material_assembly_id}"))
                )
        return rows

    async def replace_recipe(self, assembly_id: int, lines: list[AssemblyItemCreate]) -> None:
        # 中間品自体が存在することを確認
        await self.get_assembly(assembly_id)
        await self._apply_recipe(assembly_id, lines)
        await self._session.commit()

    async def _apply_recipe(self, assembly_id: int, lines: list[AssemblyItemCreate]) -> None:
        """レシピ行を検証のうえ削除→再作成する(コミットはしない、呼び出し元の外側トランザクションに委ねる)。"""
        keys = [(line.material_type, line.material_id) for line in lines]
        if len(keys) != len(set(keys)):
            raise DuplicateAssemblyItemError("同じ材料が複数行に指定されています")

        for line in lines:
            if line.material_type == "assembly":
                if line.material_id == assembly_id:
                    raise CircularAssemblyReferenceError("中間品は自分自身を材料にできません")
                if await self._would_create_cycle(assembly_id, line.material_id):
                    raise CircularAssemblyReferenceError(
                        f"assembly {line.material_id} を材料にすると循環参照になります"
                    )

        existing = await self._session.execute(
            select(AssemblyItem).where(AssemblyItem.assembly_id == assembly_id)
        )
        for item in existing.scalars().all():
            await self._session.delete(item)
        await self._session.flush()

        new_items = [
            AssemblyItem(
                assembly_id=assembly_id,
                material_part_id=line.material_id if line.material_type == "part" else None,
                material_assembly_id=line.material_id if line.material_type == "assembly" else None,
                quantity=line.quantity,
            )
            for line in lines
        ]
        self._session.add_all(new_items)
        await self._session.flush()

    async def list_usages(self, assembly_id: int) -> tuple[list[BomItem], list[AssemblyItem]]:
        """この中間品(assembly_id)を参照している箇所を全て探す。
        「BOMに展開する」機能で、商品を手動選択させる代わりに実際の使用箇所を
        一覧表示するために使う(BOMの共通行・オプション行のどちらも対象、
        他の中間品のレシピの材料として使われている場合も対象)。"""
        bom_result = await self._session.execute(select(BomItem).where(BomItem.assembly_id == assembly_id))
        bom_items = list(bom_result.scalars().unique().all())

        item_result = await self._session.execute(
            select(AssemblyItem).where(AssemblyItem.material_assembly_id == assembly_id)
        )
        assembly_items = list(item_result.scalars().all())
        return bom_items, assembly_items

    async def compute_buildable_available(self) -> dict[int, int]:
        """中間品ごとに「今すぐ使える在庫(available)」に「自身のレシピ(材料)から
        追加で組み立てられる分」を加えた数を算出する。材料がさらに中間品である
        ケース(多段構成)も再帰的に辿る。循環参照はreplace_recipe側の検証で通常
        防がれているが、防御的に辿り中のノードを0扱いにして無限再帰を回避する。
        """
        assembly_rows = (
            await self._session.execute(select(Assembly.id, Assembly.stock, Assembly.reserved))
        ).all()
        assembly_available = {row.id: row.stock - row.reserved for row in assembly_rows}

        part_rows = (await self._session.execute(select(Part.id, Part.stock, Part.reserved))).all()
        part_available = {row.id: row.stock - row.reserved for row in part_rows}

        item_rows = (
            await self._session.execute(
                select(
                    AssemblyItem.assembly_id,
                    AssemblyItem.material_part_id,
                    AssemblyItem.material_assembly_id,
                    AssemblyItem.quantity,
                )
            )
        ).all()
        recipe_by_assembly: dict[int, list] = {}
        for row in item_rows:
            recipe_by_assembly.setdefault(row.assembly_id, []).append(row)

        memo: dict[int, int] = {}
        visiting: set[int] = set()

        def resolve(assembly_id: int) -> int:
            if assembly_id in memo:
                return memo[assembly_id]
            if assembly_id in visiting:
                return 0
            visiting.add(assembly_id)

            extra: int | None = None
            for line in recipe_by_assembly.get(assembly_id, []):
                if line.material_part_id is not None:
                    material_available = part_available.get(line.material_part_id, 0)
                else:
                    material_available = resolve(line.material_assembly_id)
                buildable = material_available // line.quantity
                extra = buildable if extra is None else min(extra, buildable)

            visiting.discard(assembly_id)
            total = assembly_available.get(assembly_id, 0) + (extra if extra is not None else 0)
            memo[assembly_id] = total
            return total

        return {assembly_id: resolve(assembly_id) for assembly_id in assembly_available}

    async def compute_costs(self) -> dict[int, int]:
        """中間品ごとの原価(レシピの部品原価合計+自身の追加費用)を算出する。
        材料がさらに中間品であるケース(多段構成)も再帰的に辿り、単価未設定の
        部品/中間品は0円として扱う(粗利計算等で「不明」より「過小評価」の方が
        誤りに気付きやすいため)。循環参照はcompute_buildable_availableと同様、
        防御的に辿り中のノードを0円扱いにして無限再帰を回避する。
        """
        assembly_rows = (await self._session.execute(select(Assembly.id, Assembly.unit_cost))).all()
        extra_cost_by_assembly = {row.id: row.unit_cost or 0 for row in assembly_rows}

        part_cost = dict((await self._session.execute(select(Part.id, Part.unit_cost))).all())
        part_cost = {pid: cost or 0 for pid, cost in part_cost.items()}

        item_rows = (
            await self._session.execute(
                select(
                    AssemblyItem.assembly_id,
                    AssemblyItem.material_part_id,
                    AssemblyItem.material_assembly_id,
                    AssemblyItem.quantity,
                )
            )
        ).all()
        recipe_by_assembly: dict[int, list] = {}
        for row in item_rows:
            recipe_by_assembly.setdefault(row.assembly_id, []).append(row)

        memo: dict[int, int] = {}
        visiting: set[int] = set()

        def resolve(assembly_id: int) -> int:
            if assembly_id in memo:
                return memo[assembly_id]
            if assembly_id in visiting:
                return 0
            visiting.add(assembly_id)

            total = extra_cost_by_assembly.get(assembly_id, 0)
            for line in recipe_by_assembly.get(assembly_id, []):
                if line.material_part_id is not None:
                    total += part_cost.get(line.material_part_id, 0) * line.quantity
                else:
                    total += resolve(line.material_assembly_id) * line.quantity

            visiting.discard(assembly_id)
            memo[assembly_id] = total
            return total

        return {assembly_id: resolve(assembly_id) for assembly_id in extra_cost_by_assembly}

    async def _would_create_cycle(self, assembly_id: int, candidate_material_assembly_id: int) -> bool:
        """assembly_idのレシピにcandidateを材料として追加すると循環参照になるか判定する。

        candidateの(材料として持つ中間品を辿った)推移的閉包の中にassembly_idが
        含まれていれば、追加によって循環が生まれる。
        """
        visited: set[int] = set()
        stack = [candidate_material_assembly_id]
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            result = await self._session.execute(
                select(AssemblyItem.material_assembly_id).where(
                    AssemblyItem.assembly_id == current,
                    AssemblyItem.material_assembly_id.is_not(None),
                )
            )
            for child_id in result.scalars().all():
                if child_id == assembly_id:
                    return True
                if child_id not in visited:
                    stack.append(child_id)
        return False

    # --- 組立(ビルド) ---

    async def build_assembly(self, assembly_id: int, quantity: int, note: str | None) -> StockMovement:
        target = await self.get_assembly(assembly_id)
        recipe = await self.get_recipe_for_assembly(assembly_id)
        if not recipe:
            raise AssemblyRecipeEmptyError(f"assembly {assembly_id} にはレシピが設定されていません")

        locked_parts: dict[int, Part] = {}
        locked_assemblies: dict[int, Assembly] = {}
        for line in recipe:
            required = line.quantity * quantity
            if line.material_part_id is not None:
                if line.material_part_id not in locked_parts:
                    result = await self._session.execute(
                        select(Part).where(Part.id == line.material_part_id).with_for_update()
                    )
                    locked_parts[line.material_part_id] = result.scalars().one()
                part = locked_parts[line.material_part_id]
                available = part.stock - part.reserved
                if available < required:
                    raise InsufficientMaterialStockError(
                        f"部品「{part.name}」の在庫が不足しています(必要:{required}, 利用可能:{available})"
                    )
            else:
                material_id = line.material_assembly_id
                if material_id not in locked_assemblies:
                    result = await self._session.execute(
                        select(Assembly).where(Assembly.id == material_id).with_for_update()
                    )
                    locked_assemblies[material_id] = result.scalars().one()
                material = locked_assemblies[material_id]
                available = material.stock - material.reserved
                if available < required:
                    raise InsufficientMaterialStockError(
                        f"中間品「{material.name}」の在庫が不足しています(必要:{required}, 利用可能:{available})"
                    )

        for line in recipe:
            required = line.quantity * quantity
            if line.material_part_id is not None:
                locked_parts[line.material_part_id].stock -= required
                await record_part_movement(
                    self._session,
                    line.material_part_id,
                    -required,
                    reason="assembly_build_material",
                    note=note,
                )
            else:
                locked_assemblies[line.material_assembly_id].stock -= required
                await record_assembly_movement(
                    self._session,
                    line.material_assembly_id,
                    -required,
                    reason="assembly_build_material",
                    note=note,
                )

        target.stock += quantity
        build = StockMovement(assembly_id=assembly_id, quantity=quantity, reason="assembly_build", note=note)
        self._session.add(build)
        await self._session.commit()
        await self._session.refresh(build)
        return build
