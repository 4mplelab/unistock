from fastapi import APIRouter

from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str | bool]:
    return {"status": "ok", "demo_mode": settings.demo_mode, "version": settings.app_version}
