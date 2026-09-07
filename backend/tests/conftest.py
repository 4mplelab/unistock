import os

from cryptography.fernet import Fernet

# app.config.settings はモジュール読み込み時にインスタンス化されるため、
# app配下を最初にimportする前に環境変数を設定する必要がある。
_TOKEN_ENCRYPTION_KEY = Fernet.generate_key().decode()
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", _TOKEN_ENCRYPTION_KEY)
os.environ.setdefault("BASE_CLIENT_ID", "test-client-id")
os.environ.setdefault("BASE_CLIENT_SECRET", "test-client-secret")

# app.core.security.encrypt/decryptは通常lifespan(起動処理)でinit_fernet_keyが
# 呼ばれて初めて使えるようになる。テストではlifespanが走らないため、ここで明示的に
# 初期化する(未初期化のまま呼ぶとRuntimeErrorになる)
from app.core.security import init_fernet_key  # noqa: E402

init_fernet_key(os.environ.get("TOKEN_ENCRYPTION_KEY", _TOKEN_ENCRYPTION_KEY))

from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models import Base

# 開発用DB(実データ入り)には一切触れないよう、専用の使い捨てテストDBを使う
_TEST_DB_NAME = "unistock_test"


def _with_database(url: str, database: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


async def _ensure_test_database_exists(admin_url: str) -> None:
    engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            await conn.execute(text(f'CREATE DATABASE "{_TEST_DB_NAME}"'))
    except Exception:  # noqa: BLE001
        pass  # 既に存在する場合(2回目以降の実行)はそのまま使う
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session():
    """開発用DBとは別の使い捨てテスト専用DB(unistock_test)に対してテストする
    (実データの入った開発用DBには一切触れない)。テストごとに全テーブルを作り直す
    ことで、テスト間で状態を持ち越さない(このアプリのスキーマ規模なら十分高速)。

    接続できない環境(実Postgres無しでのローカル実行等)では、DB依存のテストだけを
    まとめてスキップする。
    """
    admin_url = _with_database(settings.database_url, "postgres")
    test_url = _with_database(settings.database_url, _TEST_DB_NAME)

    engine = create_async_engine(test_url, poolclass=NullPool)
    try:
        await _ensure_test_database_exists(admin_url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"実DBに接続できないため、DB依存のテストをスキップします: {e}")

    # expire_on_commit=Falseはapp.database.AsyncSessionLocalと同じ設定に揃える
    # (デフォルトのTrueだと、commit()の後にオブジェクトの属性へアクセスするたびに
    # 暗黙の再読み込みが走り、非同期コンテキスト外でMissingGreenletエラーになりうる)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()
