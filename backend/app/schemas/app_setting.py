from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AppSettingUpdate(BaseModel):
    value: str


class AppSettingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str
    updated_at: datetime


class NotificationTestWebhookInput(BaseModel):
    platform: str
    url: str


class NotificationTestEmailInput(BaseModel):
    to: str


class NotificationTestResult(BaseModel):
    success: bool
    message: str
