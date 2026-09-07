from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import func

from app.database import get_db
from app.models.auth import AllowedUser
from app.schemas.auth import AllowedUserCreate, AllowedUserRead
from app.services.auth_service import require_admin

router = APIRouter(prefix="/api/allowed-users", tags=["auth"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[AllowedUserRead])
async def list_allowed_users(session: AsyncSession = Depends(get_db)) -> list[AllowedUserRead]:
    result = await session.execute(select(AllowedUser).order_by(AllowedUser.created_at))
    return [AllowedUserRead.model_validate(u) for u in result.scalars().all()]


@router.post("", response_model=AllowedUserRead, status_code=201)
async def create_allowed_user(
    body: AllowedUserCreate, session: AsyncSession = Depends(get_db)
) -> AllowedUserRead:
    user = AllowedUser(identifier=body.identifier, label=body.label, is_admin=body.is_admin)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(status_code=409, detail="既に登録済みの識別子です") from e
    await session.refresh(user)
    return AllowedUserRead.model_validate(user)


@router.delete("/{user_id}", status_code=204)
async def delete_allowed_user(user_id: int, session: AsyncSession = Depends(get_db)) -> None:
    user = await session.get(AllowedUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="見つかりません")

    if user.is_admin:
        count_result = await session.execute(
            select(func.count()).select_from(AllowedUser).where(AllowedUser.is_admin.is_(True))
        )
        if count_result.scalar_one() <= 1:
            raise HTTPException(status_code=409, detail="最後の管理者は削除できません")

    await session.delete(user)
    await session.commit()
