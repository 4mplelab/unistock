from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.auth import ApiKey
from app.schemas.auth import ApiKeyCreate, ApiKeyCreateResult, ApiKeyRead
from app.services.auth_service import generate_api_key, require_admin

router = APIRouter(prefix="/api/api-keys", tags=["auth"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[ApiKeyRead])
async def list_api_keys(session: AsyncSession = Depends(get_db)) -> list[ApiKeyRead]:
    result = await session.execute(select(ApiKey).order_by(ApiKey.created_at))
    return [ApiKeyRead.model_validate(k) for k in result.scalars().all()]


@router.post("", response_model=ApiKeyCreateResult, status_code=201)
async def create_api_key(body: ApiKeyCreate, session: AsyncSession = Depends(get_db)) -> ApiKeyCreateResult:
    raw_key, key_hash, key_prefix = generate_api_key()
    key = ApiKey(name=body.name, key_hash=key_hash, key_prefix=key_prefix)
    session.add(key)
    await session.commit()
    await session.refresh(key)
    return ApiKeyCreateResult(key=ApiKeyRead.model_validate(key), raw_key=raw_key)


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(key_id: int, session: AsyncSession = Depends(get_db)) -> None:
    key = await session.get(ApiKey, key_id)
    if key is None:
        raise HTTPException(status_code=404, detail="見つかりません")
    key.revoked_at = datetime.now(timezone.utc)
    await session.commit()
