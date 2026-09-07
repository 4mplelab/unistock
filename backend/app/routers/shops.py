from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.shop import ShopCreate, ShopRead, ShopUpdate
from app.services.auth_service import require_admin, require_auth
from app.services.demo_seed_service import seed_demo_data_for_shop
from app.services.shop_service import ShopHasDataError, ShopNotFoundError, ShopService

router = APIRouter(prefix="/api/shops", tags=["shops"], dependencies=[Depends(require_auth)])


@router.get("", response_model=list[ShopRead])
async def list_shops(session: AsyncSession = Depends(get_db)) -> list[ShopRead]:
    service = ShopService(session)
    shops = await service.list_shops()
    return [ShopRead.model_validate(s) for s in shops]


@router.post("", response_model=ShopRead, status_code=201, dependencies=[Depends(require_admin)])
async def create_shop(body: ShopCreate, session: AsyncSession = Depends(get_db)) -> ShopRead:
    service = ShopService(session)
    shop = await service.create_shop(body.platform, body.name)
    return ShopRead.model_validate(shop)


@router.post("/{shop_id}/seed-demo", dependencies=[Depends(require_admin)])
async def seed_demo_for_shop(shop_id: int, session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    """デモモード限定。初回セットアップウィザードでショップ作成後に「デモ用の
    サンプルデータを投入する」を選んだときに呼ばれる。部品/中間品(共有マスタ)は
    初回のみ投入され、BOM/注文はショップごとに毎回投入される
    (demo_seed_service.seed_demo_data_for_shop参照)。"""
    if not settings.demo_mode:
        raise HTTPException(status_code=403, detail="デモモードでのみ利用できます")
    service = ShopService(session)
    try:
        shop = await service.get_shop(shop_id)
    except ShopNotFoundError as e:
        raise HTTPException(status_code=404, detail="ショップが見つかりません") from e
    seeded = await seed_demo_data_for_shop(session, shop)
    return {"seeded": seeded}


@router.patch("/{shop_id}", response_model=ShopRead, dependencies=[Depends(require_admin)])
async def update_shop(shop_id: int, body: ShopUpdate, session: AsyncSession = Depends(get_db)) -> ShopRead:
    service = ShopService(session)
    try:
        shop = await service.update_shop(shop_id, body.name, body.is_active, body.platform)
    except ShopNotFoundError as e:
        raise HTTPException(status_code=404, detail="ショップが見つかりません") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ShopRead.model_validate(shop)


@router.delete("/{shop_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_shop(shop_id: int, session: AsyncSession = Depends(get_db)) -> None:
    service = ShopService(session)
    try:
        await service.delete_shop(shop_id)
    except ShopNotFoundError as e:
        raise HTTPException(status_code=404, detail="ショップが見つかりません") from e
    except ShopHasDataError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
