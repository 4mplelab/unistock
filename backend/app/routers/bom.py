from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.bom import BomItem
from app.schemas.bom import (
    BomConditionRead,
    BomImportResult,
    BomItemCreate,
    BomItemRead,
    BomItemUpdate,
    BomListRead,
    BomProductSettingRead,
    BomProductSettingUpdate,
    BomReplaceRequest,
)
from app.services.assembly_service import AssemblyNotFoundError, AssemblyService
from app.services.auth_service import require_auth
from app.services.bom_service import NONE_COMPONENT_LABEL, BomItemNotFoundError, BomService, DuplicateBomItemError
from app.services.part_service import PartNotFoundError, PartService

router = APIRouter(prefix="/api/shops/{shop_id}/bom", tags=["bom"], dependencies=[Depends(require_auth)])


def _to_read(bom_item: BomItem, component_name: str) -> BomItemRead:
    return BomItemRead(
        id=bom_item.id,
        item_id=bom_item.item_id,
        item_name=bom_item.item_name,
        component_type=bom_item.component_type,
        part_id=bom_item.part_id,
        assembly_id=bom_item.assembly_id,
        component_name=component_name,
        quantity=bom_item.quantity,
        conditions=[
            BomConditionRead(
                selector_type=c.selector_type,
                selector_id=c.selector_id,
                group_name=c.group_name,
                choice_name=c.choice_name,
                group_order=c.group_order,
                choice_order=c.choice_order,
            )
            for c in bom_item.conditions
        ],
        created_at=bom_item.created_at,
        updated_at=bom_item.updated_at,
    )


async def _resolve_component_name(
    session: AsyncSession, component_type: str, part_id: int | None, assembly_id: int | None
) -> str:
    if component_type == "none":
        return NONE_COMPONENT_LABEL

    if component_type == "part":
        part_service = PartService(session)
        try:
            part = await part_service.get_part(part_id)
        except PartNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return part.name

    assembly_service = AssemblyService(session)
    try:
        assembly = await assembly_service.get_assembly(assembly_id)
    except AssemblyNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return assembly.name


@router.get("", response_model=list[BomItemRead])
async def list_bom_items(
    shop_id: int, item_id: str | None = None, session: AsyncSession = Depends(get_db)
) -> list[BomItemRead]:
    service = BomService(session)
    rows = await service.list_bom_items(shop_id, item_id)
    return [_to_read(bom_item, component_name) for bom_item, component_name in rows]


@router.get("/products", response_model=BomListRead)
async def list_bom_products(
    shop_id: int,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_db),
) -> BomListRead:
    """商品(item_id)単位でページングしたBOM一覧。BOM一覧画面(横断表示)専用。

    単一商品のBOM編集(item_id指定)には引き続き上のlist_bom_itemsを使う。
    """
    service = BomService(session)
    rows, total = await service.list_bom_items_page(shop_id, search, limit=limit, offset=offset)
    return BomListRead(items=[_to_read(bom_item, component_name) for bom_item, component_name in rows], total=total)


@router.get("/product-settings/{item_id}", response_model=BomProductSettingRead)
async def get_bom_product_setting(
    shop_id: int, item_id: str, session: AsyncSession = Depends(get_db)
) -> BomProductSettingRead:
    service = BomService(session)
    matrix_layout, buildable_alert_threshold = await service.get_product_setting(shop_id, item_id)
    return BomProductSettingRead(
        item_id=item_id, matrix_layout=matrix_layout, buildable_alert_threshold=buildable_alert_threshold
    )


@router.put("/product-settings/{item_id}", response_model=BomProductSettingRead)
async def update_bom_product_setting(
    shop_id: int, item_id: str, body: BomProductSettingUpdate, session: AsyncSession = Depends(get_db)
) -> BomProductSettingRead:
    service = BomService(session)
    matrix_layout, buildable_alert_threshold = await service.set_product_setting(
        shop_id, item_id, body.matrix_layout, body.buildable_alert_threshold
    )
    return BomProductSettingRead(
        item_id=item_id, matrix_layout=matrix_layout, buildable_alert_threshold=buildable_alert_threshold
    )


@router.post("", response_model=BomItemRead, status_code=201)
async def create_bom_item(
    shop_id: int, body: BomItemCreate, session: AsyncSession = Depends(get_db)
) -> BomItemRead:
    component_name = await _resolve_component_name(session, body.component_type, body.part_id, body.assembly_id)

    service = BomService(session)
    try:
        bom_item = await service.create_bom_item(shop_id, body)
    except DuplicateBomItemError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return _to_read(bom_item, component_name)


@router.get("/export")
async def export_bom(shop_id: int, session: AsyncSession = Depends(get_db)) -> Response:
    service = BomService(session)
    csv_content = await service.export_csv(shop_id)
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=bom.csv"},
    )


@router.post("/import", response_model=BomImportResult)
async def import_bom(
    shop_id: int, file: UploadFile = File(...), session: AsyncSession = Depends(get_db)
) -> BomImportResult:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"CSVの文字コードが不正です: {e}") from e

    service = BomService(session)
    return await service.import_csv(shop_id, text)


@router.put("/by-item/{item_id}", response_model=list[BomItemRead])
async def replace_bom_for_item(
    shop_id: int, item_id: str, body: BomReplaceRequest, session: AsyncSession = Depends(get_db)
) -> list[BomItemRead]:
    component_names: dict[tuple[str, int], str] = {}
    for line in body.lines:
        key = (line.component_type, line.part_id if line.part_id is not None else line.assembly_id)
        if key in component_names:
            continue
        component_names[key] = await _resolve_component_name(
            session, line.component_type, line.part_id, line.assembly_id
        )

    service = BomService(session)
    try:
        bom_items = await service.replace_bom_for_item(shop_id, item_id, body.item_name, body.lines)
    except DuplicateBomItemError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return [
        _to_read(
            bi,
            component_names[(bi.component_type, bi.part_id if bi.part_id is not None else bi.assembly_id)],
        )
        for bi in bom_items
    ]


@router.patch("/{bom_item_id}", response_model=BomItemRead)
async def update_bom_item(
    shop_id: int, bom_item_id: int, body: BomItemUpdate, session: AsyncSession = Depends(get_db)
) -> BomItemRead:
    service = BomService(session)
    try:
        bom_item = await service.update_bom_item(shop_id, bom_item_id, body)
    except BomItemNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    component_name = await _resolve_component_name(
        session, bom_item.component_type, bom_item.part_id, bom_item.assembly_id
    )
    return _to_read(bom_item, component_name)


@router.delete("/{bom_item_id}", status_code=204)
async def delete_bom_item(shop_id: int, bom_item_id: int, session: AsyncSession = Depends(get_db)) -> None:
    service = BomService(session)
    try:
        await service.delete_bom_item(shop_id, bom_item_id)
    except BomItemNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
