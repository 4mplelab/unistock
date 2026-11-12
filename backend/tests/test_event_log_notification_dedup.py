from sqlalchemy import select

import app.services.event_log_service as event_log_module
from app.config import settings
from app.models.event_log import EventLog
from app.services.event_log_service import EventLogService


async def test_same_notifiable_event_is_aggregated_and_notified_once(db_session, monkeypatch):
    sent = []

    async def fake_notify(session, category, message, shop_ids):
        sent.append(message)

    monkeypatch.setattr(event_log_module, "notify", fake_notify)
    monkeypatch.setattr(settings, "demo_mode", False)
    service = EventLogService(db_session)

    for _ in range(3):
        await service.log(category="auth_error", level="error", message="同じエラー")
    await service.log(category="auth_error", level="error", message="別のエラー")

    rows = (await db_session.execute(select(EventLog).order_by(EventLog.id))).scalars().all()
    assert [(r.message, r.occurrence_count) for r in rows] == [("同じエラー", 3), ("別のエラー", 1)]
    assert sent == ["同じエラー", "別のエラー"]


async def test_ongoing_event_is_renotified_every_4_hours(db_session, monkeypatch):
    from datetime import datetime, timedelta, timezone

    sent = []

    async def fake_notify(session, category, message, shop_ids):
        sent.append(message)

    monkeypatch.setattr(event_log_module, "notify", fake_notify)
    monkeypatch.setattr(settings, "demo_mode", False)
    service = EventLogService(db_session)

    await service.log(category="auth_error", level="error", message="続いているエラー")
    row = (await db_session.execute(select(EventLog))).scalars().one()

    # 3時間後: まだ再通知しない
    row.last_notified_at = datetime.now(timezone.utc) - timedelta(hours=3)
    await db_session.commit()
    await service.log(category="auth_error", level="error", message="続いているエラー")
    assert len(sent) == 1

    # 前回の通知から4時間以上: 再通知する(行は増やさずカウントアップ)
    row.last_notified_at = datetime.now(timezone.utc) - timedelta(hours=4, minutes=1)
    await db_session.commit()
    await service.log(category="auth_error", level="error", message="続いているエラー")

    rows = (await db_session.execute(select(EventLog))).scalars().all()
    assert len(rows) == 1 and rows[0].occurrence_count == 3
    assert len(sent) == 2
    assert "これまでに3回発生しています" in sent[1]
