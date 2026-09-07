from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.assembly import Assembly
from app.models.assembly_item import AssemblyItem
from app.models.stock_movement import StockMovement
from app.schemas.bom import BomConditionRead
from app.schemas.order_reservation import ReservingOrderRead
from app.schemas.stock_movement import StockMovementListRead, StockMovementRead
from app.services.auth_service import require_auth
from app.services.reservation_lookup_service import list_reserving_orders_for_assembly
from app.services.stock_movement_service import list_movements, page_to_read
from app.schemas.assembly import (
    AssemblyBomUsageRead,
    AssemblyBuildableAvailable,
    AssemblyBuildCreate,
    AssemblyCostRead,
    AssemblyCreate,
    AssemblyImportResult,
    AssemblyItemCreate,
    AssemblyItemRead,
    AssemblyRead,
    AssemblyRecipeUsageRead,
    AssemblyRecipeReplace,
    AssemblyUpdate,
    AssemblyUsagesRead,
)
from app.services.assembly_service import (
    AssemblyInUseError,
    AssemblyNotFoundError,
    AssemblyRecipeEmptyError,
    AssemblyService,
    CircularAssemblyReferenceError,
    DuplicateAssemblyItemError,
    InsufficientMaterialStockError,
)
from app.services.part_service import PartNotFoundError, PartService

router = APIRouter(prefix="/api/assemblies", tags=["assemblies"], dependencies=[Depends(require_auth)])


async def _validate_recipe_materials(
    session: AsyncSession, service: AssemblyService, lines: list[AssemblyItemCreate]
) -> None:
    part_service = PartService(session)
    try:
        for line in lines:
            if line.material_type == "part":
                await part_service.get_part(line.material_id)
            else:
                await service.get_assembly(line.material_id)
    except PartNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"材料として指定された中間品が見つかりません: {e}") from e


def _item_to_read(item: AssemblyItem, material_name: str) -> AssemblyItemRead:
    return AssemblyItemRead(
        id=item.id,
        material_type="part" if item.material_part_id is not None else "assembly",
        material_id=item.material_part_id if item.material_part_id is not None else item.material_assembly_id,
        material_name=material_name,
        quantity=item.quantity,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _movement_to_read(movement: StockMovement, component_name: str) -> StockMovementRead:
    return StockMovementRead(
        id=movement.id,
        component_type="assembly",
        component_id=movement.assembly_id,
        component_name=component_name,
        quantity=movement.quantity,
        reason=movement.reason,
        note=movement.note,
        order_id=movement.order_id,
        order_unique_key=None,
        purchase_order_id=movement.purchase_order_id,
        shop_id=movement.shop_id,
        created_at=movement.created_at,
    )


@router.get("", response_model=list[AssemblyRead])
async def list_assemblies(session: AsyncSession = Depends(get_db)) -> list[AssemblyRead]:
    service = AssemblyService(session)
    assemblies = await service.list_assemblies()
    return [AssemblyRead.model_validate(a) for a in assemblies]


@router.post("", response_model=AssemblyRead, status_code=201)
async def create_assembly(body: AssemblyCreate, session: AsyncSession = Depends(get_db)) -> AssemblyRead:
    service = AssemblyService(session)
    if body.recipe:
        await _validate_recipe_materials(session, service, body.recipe)

    try:
        assembly = await service.create_assembly(body)
    except (DuplicateAssemblyItemError, CircularAssemblyReferenceError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return AssemblyRead.model_validate(assembly)


@router.get("/export")
async def export_assemblies(session: AsyncSession = Depends(get_db)) -> Response:
    service = AssemblyService(session)
    csv_content = await service.export_csv()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=assemblies.csv"},
    )


@router.post("/import", response_model=AssemblyImportResult)
async def import_assemblies(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_db)
) -> AssemblyImportResult:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"CSVの文字コードが不正です: {e}") from e

    service = AssemblyService(session)
    return await service.import_csv(text)


@router.get("/buildable-available", response_model=list[AssemblyBuildableAvailable])
async def list_buildable_available(session: AsyncSession = Depends(get_db)) -> list[AssemblyBuildableAvailable]:
    """各中間品の在庫に、材料(部品/中間品)から追加で組み立てられる分を加えた数。
    BOM一覧の作成可能数計算で使用する。"""
    service = AssemblyService(session)
    buildable = await service.compute_buildable_available()
    return [AssemblyBuildableAvailable(id=aid, available=available) for aid, available in buildable.items()]


@router.get("/costs", response_model=list[AssemblyCostRead])
async def list_costs(session: AsyncSession = Depends(get_db)) -> list[AssemblyCostRead]:
    """各中間品の原価(レシピの部品原価合計+自身の追加費用)。中間品一覧・BOM編集画面の
    原価表示で使用する。"""
    service = AssemblyService(session)
    costs = await service.compute_costs()
    return [AssemblyCostRead(id=aid, cost=cost) for aid, cost in costs.items()]


@router.get("/{assembly_id}", response_model=AssemblyRead)
async def get_assembly(assembly_id: int, session: AsyncSession = Depends(get_db)) -> AssemblyRead:
    service = AssemblyService(session)
    try:
        assembly = await service.get_assembly(assembly_id)
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return AssemblyRead.model_validate(assembly)


@router.patch("/{assembly_id}", response_model=AssemblyRead)
async def update_assembly(
    assembly_id: int, body: AssemblyUpdate, session: AsyncSession = Depends(get_db)
) -> AssemblyRead:
    service = AssemblyService(session)
    if body.recipe is not None:
        await _validate_recipe_materials(session, service, body.recipe)

    try:
        assembly = await service.update_assembly(assembly_id, body)
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except (DuplicateAssemblyItemError, CircularAssemblyReferenceError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return AssemblyRead.model_validate(assembly)


@router.get("/{assembly_id}/usages", response_model=AssemblyUsagesRead)
async def get_assembly_usages(assembly_id: int, session: AsyncSession = Depends(get_db)) -> AssemblyUsagesRead:
    service = AssemblyService(session)
    bom_items, assembly_items = await service.list_usages(assembly_id)

    parent_ids = [ai.assembly_id for ai in assembly_items]
    names: dict[int, str] = {}
    if parent_ids:
        result = await session.execute(select(Assembly.id, Assembly.name).where(Assembly.id.in_(parent_ids)))
        names = dict(result.all())

    return AssemblyUsagesRead(
        bom_items=[
            AssemblyBomUsageRead(
                bom_item_id=b.id,
                shop_id=b.shop_id,
                item_id=b.item_id,
                item_name=b.item_name,
                quantity=b.quantity,
                conditions=[
                    BomConditionRead(
                        selector_type=c.selector_type,
                        selector_id=c.selector_id,
                        group_name=c.group_name,
                        choice_name=c.choice_name,
                        group_order=c.group_order,
                        choice_order=c.choice_order,
                    )
                    for c in b.conditions
                ],
            )
            for b in bom_items
        ],
        assembly_items=[
            AssemblyRecipeUsageRead(
                assembly_item_id=ai.id,
                assembly_id=ai.assembly_id,
                assembly_name=names.get(ai.assembly_id, f"#{ai.assembly_id}"),
                quantity=ai.quantity,
            )
            for ai in assembly_items
        ],
    )


@router.get("/{assembly_id}/reservations", response_model=list[ReservingOrderRead])
async def list_assembly_reservations(
    assembly_id: int, session: AsyncSession = Depends(get_db)
) -> list[ReservingOrderRead]:
    orders = await list_reserving_orders_for_assembly(session, assembly_id)
    return [ReservingOrderRead.model_validate(o.__dict__) for o in orders]


@router.delete("/{assembly_id}", status_code=204)
async def delete_assembly(assembly_id: int, session: AsyncSession = Depends(get_db)) -> None:
    service = AssemblyService(session)
    try:
        await service.delete_assembly(assembly_id)
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except AssemblyInUseError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.get("/{assembly_id}/recipe", response_model=list[AssemblyItemRead])
async def get_recipe(assembly_id: int, session: AsyncSession = Depends(get_db)) -> list[AssemblyItemRead]:
    service = AssemblyService(session)
    rows = await service.list_recipe_with_names(assembly_id)
    return [_item_to_read(item, name) for item, name in rows]


@router.put("/{assembly_id}/recipe", response_model=list[AssemblyItemRead])
async def replace_recipe(
    assembly_id: int, body: AssemblyRecipeReplace, session: AsyncSession = Depends(get_db)
) -> list[AssemblyItemRead]:
    service = AssemblyService(session)
    if body.lines:
        await _validate_recipe_materials(session, service, body.lines)

    try:
        await service.replace_recipe(assembly_id, body.lines)
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except (DuplicateAssemblyItemError, CircularAssemblyReferenceError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    rows = await service.list_recipe_with_names(assembly_id)
    return [_item_to_read(item, name) for item, name in rows]


@router.post("/{assembly_id}/build", response_model=StockMovementRead, status_code=201)
async def build_assembly(
    assembly_id: int, body: AssemblyBuildCreate, session: AsyncSession = Depends(get_db)
) -> StockMovementRead:
    service = AssemblyService(session)
    try:
        build = await service.build_assembly(assembly_id, body.quantity, body.note)
        assembly = await service.get_assembly(assembly_id)
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except AssemblyRecipeEmptyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except InsufficientMaterialStockError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return _movement_to_read(build, assembly.name)


@router.get("/{assembly_id}/stock-movements", response_model=StockMovementListRead)
async def list_assembly_stock_movements(
    assembly_id: int, limit: int = 20, offset: int = 0, session: AsyncSession = Depends(get_db)
) -> StockMovementListRead:
    page = await list_movements(session, assembly_id=assembly_id, limit=limit, offset=offset)
    return page_to_read(page)
