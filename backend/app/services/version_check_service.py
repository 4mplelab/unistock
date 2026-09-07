import logging
import re

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.app_setting_service import AppSettingService

logger = logging.getLogger(__name__)

GITHUB_REPO = "4mplelab/unistock"
_LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
_RAW_FILE_URL = "https://raw.githubusercontent.com/{repo}/{ref}/{path}"

# ヘッダーの通知ベルで「×」を押して既読にしたバージョン。バージョン単位で保持するため、
# 既読にした後でもさらに新しいリリースが出れば再度通知される
DISMISSED_VERSION_KEY = "update_check.dismissed_version"

# 「実行中バージョン時点の中身」と「最新リリース時点の中身」をGitHub上で直接比較する対象。
# docker-compose.yml/.envはビルド済みイメージには含まれず、運用者がサーバーに個別に配置して
# 使い続けるファイルのため、イメージのバージョンが上がっただけでは自動的に追従しない
_COMPOSE_PATH = "docker-compose.yml"
_ENV_EXAMPLE_PATH = ".env.example"
_ENV_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=", re.MULTILINE)


async def get_latest_release() -> dict[str, str] | None:
    """GitHubの最新リリース(タグ名・リリースページURL)を取得する。

    自動更新は行わない(ユーザーの明示的な判断)ため、設定画面での通知表示専用。
    devビルド(未リリースのローカル/PRビルド)では呼び出し元が比較自体をスキップする。
    ネットワークエラー・レート制限等は致命的でないため、失敗時はNoneを返すだけにする。
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                _LATEST_RELEASE_URL, headers={"Accept": "application/vnd.github+json"}
            )
        if resp.status_code != 200:
            logger.info("最新リリースの取得に失敗しました(status=%s)", resp.status_code)
            return None
        data = resp.json()
        return {"tag_name": data["tag_name"], "html_url": data["html_url"]}
    except Exception:  # noqa: BLE001
        logger.exception("最新リリースの取得中に予期しないエラーが発生しました")
        return None


def _extract_env_keys(text: str) -> set[str]:
    return set(_ENV_KEY_RE.findall(text))


async def _fetch_raw_file(client: httpx.AsyncClient, repo: str, ref: str, path: str) -> str | None:
    try:
        resp = await client.get(_RAW_FILE_URL.format(repo=repo, ref=ref, path=path))
        if resp.status_code != 200:
            return None
        return resp.text
    except Exception:  # noqa: BLE001
        return None


async def config_files_changed(
    client: httpx.AsyncClient, current_ref: str, latest_ref: str, repo: str = GITHUB_REPO
) -> bool:
    """実行中バージョン時点と最新リリース時点で、docker-compose.yml/.env.exampleの中身が
    変わっているかをGitHub上のスナップショット同士で直接比較する(何バージョン飛ばしても、
    常にこの2点間の比較になるため正しく検知できる)。

    docker-compose.ymlはテキスト全体を比較する(コメントだけの差分でも拾うが、コメント修正で
    誤反応するより、意図しない変更を見逃す方が問題のため許容する)。.env.exampleはコメント・
    デフォルト値の変更では反応しないよう、`KEY=`から拾える変数名の集合だけを比較する。

    どちらかのfetchに失敗した場合は「変更なし」として扱う(誤って「変更あり」と出して
    運用者を混乱させるより、見逃す方を優先する)。
    """
    compose_current = await _fetch_raw_file(client, repo, current_ref, _COMPOSE_PATH)
    compose_latest = await _fetch_raw_file(client, repo, latest_ref, _COMPOSE_PATH)
    if compose_current is not None and compose_latest is not None and compose_current != compose_latest:
        return True

    env_current = await _fetch_raw_file(client, repo, current_ref, _ENV_EXAMPLE_PATH)
    env_latest = await _fetch_raw_file(client, repo, latest_ref, _ENV_EXAMPLE_PATH)
    if env_current is not None and env_latest is not None:
        if _extract_env_keys(env_current) != _extract_env_keys(env_latest):
            return True

    return False


async def check_for_update(session: AsyncSession) -> dict[str, str | bool] | None:
    """実行中バージョンと最新リリースを比較する。devビルド中は常にNone。

    既読にした(dismissした)バージョンと最新リリースが一致する間はupdate_availableをFalseにする。
    これにより「×で消す」操作は該当バージョンだけを既読にし、次にさらに新しいリリースが
    出れば別バージョンとして再度通知される
    """
    if settings.app_version == "dev":
        return None
    latest = await get_latest_release()
    if latest is None:
        return None
    dismissed_version = await AppSettingService(session).get_value(DISMISSED_VERSION_KEY, "")
    update_available = latest["tag_name"] != settings.app_version and latest["tag_name"] != dismissed_version

    files_changed = False
    if update_available:
        async with httpx.AsyncClient(timeout=5.0) as client:
            files_changed = await config_files_changed(client, settings.app_version, latest["tag_name"])

    return {
        "current_version": settings.app_version,
        "latest_version": latest["tag_name"],
        "update_available": update_available,
        "release_url": latest["html_url"],
        "config_files_changed": files_changed,
    }
