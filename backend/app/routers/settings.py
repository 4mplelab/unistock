from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.app_setting import (
    AppSettingRead,
    AppSettingUpdate,
    NotificationTestEmailInput,
    NotificationTestResult,
    NotificationTestWebhookInput,
)
from app.services import notification_service, order_scheduler
from app.services.app_setting_service import AppSettingService
from app.services.auth_service import require_auth

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_auth)])


@router.get("", response_model=list[AppSettingRead])
async def list_settings(session: AsyncSession = Depends(get_db)) -> list[AppSettingRead]:
    service = AppSettingService(session)
    settings = await service.list_all()
    return [AppSettingRead.model_validate(s) for s in settings]


@router.put("/{key}", response_model=AppSettingRead)
async def update_setting(
    key: str, body: AppSettingUpdate, session: AsyncSession = Depends(get_db)
) -> AppSettingRead:
    if key == order_scheduler.ORDER_POLLER_INTERVAL_KEY:
        try:
            interval = int(body.value)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="interval_secondsは整数で指定してください") from e
        if interval <= 0:
            raise HTTPException(status_code=400, detail="interval_secondsは1以上で指定してください")

    service = AppSettingService(session)
    setting = await service.set(key, body.value)

    if key == order_scheduler.ORDER_POLLER_INTERVAL_KEY:
        order_scheduler.reschedule_interval(interval)

    return AppSettingRead.model_validate(setting)


@router.post("/notification/test-webhook", response_model=NotificationTestResult)
async def test_notification_webhook(body: NotificationTestWebhookInput) -> NotificationTestResult:
    success, message = await notification_service.send_test_webhook(body.platform, body.url)
    return NotificationTestResult(success=success, message=message)


@router.post("/notification/test-email", response_model=NotificationTestResult)
async def test_notification_email(body: NotificationTestEmailInput) -> NotificationTestResult:
    success, message = await notification_service.send_test_email(body.to)
    return NotificationTestResult(success=success, message=message)
