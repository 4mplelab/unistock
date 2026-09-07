from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.data_reset import DataResetRequest
from app.services.data_reset_service import (
    RESET_ALL_PHRASE,
    RESET_ORDER_HISTORY_PHRASE,
    ConfirmationMismatchError,
    DataResetService,
    FeatureDisabledError,
)
from app.services.auth_service import require_admin
from app.services.retention_service import RetentionService

router = APIRouter(prefix="/api/data", tags=["data"], dependencies=[Depends(require_admin)])

_DEMO_MODE_BLOCKED_DETAIL = "デモモードではこの操作はできません"


def _reject_in_demo_mode() -> None:
    """デモモードはrequire_admin自体をバイパスするため、破壊的な操作は
    エンドポイントの入口でも個別に拒否する(第三者が誰でも実行できてしまうため)。"""
    if settings.demo_mode:
        raise HTTPException(status_code=403, detail=_DEMO_MODE_BLOCKED_DETAIL)


@router.get("/reset-phrases")
async def get_reset_phrases() -> dict[str, str]:
    """確認ダイアログに表示する、入力必須の確認文字列をフロントへ渡す。"""
    return {"reset_all": RESET_ALL_PHRASE, "reset_order_history": RESET_ORDER_HISTORY_PHRASE}


@router.post("/reset-all", status_code=204)
async def reset_all(body: DataResetRequest, session: AsyncSession = Depends(get_db)) -> None:
    _reject_in_demo_mode()
    service = DataResetService(session)
    try:
        await service.reset_all(body.confirm_phrase)
    except ConfirmationMismatchError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/reset-order-history", status_code=204)
async def reset_order_history(body: DataResetRequest, session: AsyncSession = Depends(get_db)) -> None:
    _reject_in_demo_mode()
    service = DataResetService(session)
    try:
        await service.reset_order_history(body.confirm_phrase)
    except ConfirmationMismatchError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FeatureDisabledError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.post("/cleanup-retention")
async def cleanup_retention(session: AsyncSession = Depends(get_db)) -> dict[str, int]:
    """設定された保持日数を過ぎた完了済みデータ(注文・発注・スケジュール・組立履歴)を今すぐ削除する。

    通常は24時間おきに自動実行されるが、設定変更後の即時反映や動作確認のために手動実行もできる。
    """
    _reject_in_demo_mode()
    service = RetentionService(session)
    return await service.run_all()
