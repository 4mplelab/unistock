from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.providers.base import ECAuthError
from app.providers.factory import build_provider
from app.schemas.item import (
    ItemDescriptionUpdate,
    ItemOptionRead,
    ItemRead,
    ItemUpdateRead,
    ItemVariationRead,
)
from app.services.auth_service import require_auth
from app.services.shop_service import ShopNotFoundError, ShopService

router = APIRouter(prefix="/api/shops/{shop_id}/items", tags=["items"], dependencies=[Depends(require_auth)])


async def _get_shop_or_404(shop_id: int, session: AsyncSession):
    try:
        return await ShopService(session).get_shop(shop_id)
    except ShopNotFoundError as e:
        raise HTTPException(status_code=404, detail="ショップが見つかりません") from e


@router.get("", response_model=list[ItemRead])
async def list_items(shop_id: int, session: AsyncSession = Depends(get_db)) -> list[ItemRead]:
    shop = await _get_shop_or_404(shop_id, session)
    provider = build_provider(shop, session)
    items = await provider.list_items()
    return [ItemRead(item_id=i.item_id, title=i.title, stock=i.stock) for i in items]


@router.get("/{item_id}", response_model=ItemRead)
async def get_item(shop_id: int, item_id: str, session: AsyncSession = Depends(get_db)) -> ItemRead:
    shop = await _get_shop_or_404(shop_id, session)
    provider = build_provider(shop, session)
    try:
        item = await provider.get_item(item_id)
    except ECAuthError as e:
        raise HTTPException(status_code=400, detail=f"未認証です: {e}") from e

    if item is None:
        raise HTTPException(status_code=404, detail="商品が見つかりません")
    return ItemRead(item_id=item.item_id, title=item.title, stock=item.stock)


@router.get("/{item_id}/options", response_model=list[ItemOptionRead])
async def get_item_options(
    shop_id: int, item_id: str, session: AsyncSession = Depends(get_db)
) -> list[ItemOptionRead]:
    shop = await _get_shop_or_404(shop_id, session)
    provider = build_provider(shop, session)
    try:
        options = await provider.get_item_options(item_id)
    except ECAuthError as e:
        raise HTTPException(status_code=400, detail=f"未認証です: {e}") from e

    return [
        ItemOptionRead(
            option_id=opt.option_id,
            option_name=opt.option_name,
            choices=[
                {
                    "option_variation_id": c.option_variation_id,
                    "variation_name": c.variation_name,
                    "price": c.price,
                }
                for c in opt.choices
            ],
        )
        for opt in options
    ]


@router.get("/{item_id}/variations", response_model=list[ItemVariationRead])
async def get_item_variations(
    shop_id: int, item_id: str, session: AsyncSession = Depends(get_db)
) -> list[ItemVariationRead]:
    shop = await _get_shop_or_404(shop_id, session)
    provider = build_provider(shop, session)
    try:
        variations = await provider.get_item_variations(item_id)
    except ECAuthError as e:
        raise HTTPException(status_code=400, detail=f"未認証です: {e}") from e

    return [
        ItemVariationRead(variation_id=v.variation_id, variation_name=v.variation_name, stock=v.stock)
        for v in variations
    ]


@router.patch("/{item_id}", response_model=ItemUpdateRead)
async def update_item_description(
    shop_id: int, item_id: str, body: ItemDescriptionUpdate, session: AsyncSession = Depends(get_db)
) -> ItemUpdateRead:
    shop = await _get_shop_or_404(shop_id, session)
    provider = build_provider(shop, session)
    try:
        result = await provider.update_item_description(item_id, body.detail)
    except ECAuthError as e:
        raise HTTPException(status_code=400, detail=f"未認証です: {e}") from e

    if not result.success:
        raise HTTPException(status_code=400, detail=result.error_message or "商品説明の更新に失敗しました")

    return ItemUpdateRead(item_id=item_id, success=True)
