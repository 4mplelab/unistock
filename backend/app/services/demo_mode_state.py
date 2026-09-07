import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.oauth_token import ECOAuthToken
from app.services.data_reset_service import RESET_ALL_PHRASE, DataResetService

logger = logging.getLogger(__name__)


async def _is_production(session: AsyncSession) -> bool:
    """「本番」= ec_oauth_tokensに実際の連携トークンが存在するデータの状態。
    DEMO_MODE(通常/デモの実行モード)とは独立した概念で、デモモードとは
    同じ永続化データ上で絶対に共存させてはいけない(本番の実データを晒す/
    消してしまう事故になるため)。
    """
    result = await session.execute(select(ECOAuthToken.platform).limit(1))
    return result.scalars().first() is not None

# settings.log_dirは名前付きボリューム(unistock_backend_logs)にマウントされており
# コンテナの再作成をまたいで残るため、ここに前回起動時のdemo_mode状態を記録する。
# DBのAppSettingではなく単純なテキストファイルにしているのは、これがアプリの業務設定
# ではなく起動処理そのものの内部状態(前回どちらのモードで起動したか)だから
_STATE_FILENAME = ".demo_mode_state"


def _state_path() -> Path:
    return Path(settings.log_dir) / _STATE_FILENAME


def _read_previous_state() -> bool:
    path = _state_path()
    if not path.exists():
        return False
    return path.read_text().strip() == "true"


def _write_current_state(value: bool) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("true" if value else "false")


async def sync_demo_mode_state(session: AsyncSession) -> None:
    """起動のたびに、前回起動時のdemo_modeと今回を比較する。

    OFF→ON(デモモードに入った瞬間): 全データ消去のみ行い、ショップ0件のまま
    起動を終える(デモデータは自動投入しない)。ショップ0件
    なのでAppShellGateが初回セットアップウィザード(/setup)へ誘導し、ウィザードで
    選んだプラットフォームに応じたデモデータをショップ作成時に投入する
    (frontend `ShopSetupFlow` の「デモ用のサンプルデータを投入する」ボタン →
    `POST /api/shops/{shop_id}/seed-demo` → `demo_seed_service.seed_demo_data_for_shop`)。
    ON→OFF(デモモードを抜けた瞬間): 全データ消去のみ行う(元から再投入はしない)。
    デモモード中は本番の実トークンが存在し得ない(_is_production/exchange_codeの
    ガードにより、デモモード中に本物の連携が成立することはない)ため、この2方向
    どちらの自動消去も本番データを壊すリスクは無い。
    ON→ONのまま(デモモード中のクラッシュ再起動やコンテナ再作成)、OFF→OFFのままでは
    何もしない(そうしないと、再起動が起きるたびにデータが消えてしまう)。

    最優先の安全策として、DEMO_MODE=trueが指定されていても「本番」状態(実際の
    連携トークンが存在する)なら、デモモードでの起動そのものを拒否し、
    settings.demo_modeを強制的にFalseへ上書きして通常モードとして起動する。
    本番の実データを消す/認証なしで晒すという二重の事故を機械的に防ぐため。
    この場合に「デモとして使い回したい」なら、アプリの機能ではなく
    `docker compose down -v` 等でDB(連携情報含む永続化データ全て)を
    完全に削除してから起動し直す、という運用上の手順を踏む
    """
    if settings.demo_mode and await _is_production(session):
        logger.critical(
            "DEMO_MODE=trueですが、本番の連携トークンが存在するため、デモモードでの"
            "起動を拒否し通常モードとして起動します。デモとして使い回すには、"
            "docker compose down -v 等で永続化データを完全に削除してからにしてください"
        )
        settings.demo_mode = False
        _write_current_state(False)
        return

    previous = _read_previous_state()
    current = settings.demo_mode

    if current and not previous:
        logger.warning("デモモードに入ったため、データを全消去します(ショップ作成時にプラットフォーム別のデモデータを投入します)")
        reset_service = DataResetService(session)
        await reset_service.reset_all(RESET_ALL_PHRASE)
        await reset_service.reset_shops()
    elif not current and previous:
        logger.warning("デモモードを抜けたため、データを全消去します(デモデータの再投入はしません)")
        reset_service = DataResetService(session)
        await reset_service.reset_all(RESET_ALL_PHRASE)
        await reset_service.reset_shops()

    _write_current_state(current)
