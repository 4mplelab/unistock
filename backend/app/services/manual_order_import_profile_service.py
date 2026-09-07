from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_order_import_profile import ManualOrderImportProfile
from app.schemas.manual_order_import_profile import (
    ManualOrderCsvColumnMapping,
    ManualOrderImportProfileCreate,
    ManualOrderImportProfileRead,
)


class ManualOrderImportProfileNotFoundError(Exception):
    pass


class ManualOrderImportProfileAlreadyExistsError(Exception):
    pass


def _to_read(profile: ManualOrderImportProfile) -> ManualOrderImportProfileRead:
    return ManualOrderImportProfileRead(
        id=profile.id,
        name=profile.name,
        created_at=profile.created_at,
        mapping=ManualOrderCsvColumnMapping(
            order_ref=profile.order_ref_column,
            ordered_at=profile.ordered_at_column,
            last_name=profile.last_name_column,
            first_name=profile.first_name_column,
            prefecture=profile.prefecture_column,
            address=profile.address_column,
            email=profile.email_column,
            item_id=profile.item_id_column,
            quantity=profile.quantity_column,
            variation_name=profile.variation_name_column,
            price=profile.price_column,
        ),
    )


class ManualOrderImportProfileService:
    """手動注文CSVインポートの列マッピングプロファイル(ショップごとに名前を付けて保存)のCRUD。"""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_by_shop(self, shop_id: int) -> list[ManualOrderImportProfileRead]:
        stmt = (
            select(ManualOrderImportProfile)
            .where(ManualOrderImportProfile.shop_id == shop_id)
            .order_by(ManualOrderImportProfile.name)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [_to_read(row) for row in rows]

    async def create(self, shop_id: int, data: ManualOrderImportProfileCreate) -> ManualOrderImportProfileRead:
        profile = ManualOrderImportProfile(
            shop_id=shop_id,
            name=data.name,
            order_ref_column=data.mapping.order_ref,
            ordered_at_column=data.mapping.ordered_at,
            last_name_column=data.mapping.last_name,
            first_name_column=data.mapping.first_name,
            prefecture_column=data.mapping.prefecture,
            address_column=data.mapping.address,
            email_column=data.mapping.email,
            item_id_column=data.mapping.item_id,
            quantity_column=data.mapping.quantity,
            variation_name_column=data.mapping.variation_name,
            price_column=data.mapping.price,
        )
        self._session.add(profile)
        try:
            await self._session.commit()
        except IntegrityError as e:
            await self._session.rollback()
            raise ManualOrderImportProfileAlreadyExistsError(f"プロファイル名 '{data.name}' は既に使用されています") from e
        await self._session.refresh(profile)
        return _to_read(profile)

    async def delete(self, shop_id: int, profile_id: int) -> None:
        profile = await self._session.get(ManualOrderImportProfile, profile_id)
        if profile is None or profile.shop_id != shop_id:
            raise ManualOrderImportProfileNotFoundError(f"profile {profile_id} not found")
        await self._session.delete(profile)
        await self._session.commit()
