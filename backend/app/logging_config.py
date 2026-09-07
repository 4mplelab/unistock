import logging
import logging.handlers
import os

from app.config import settings


def configure_logging() -> None:
    """アプリ全体のログ設定。

    標準出力(開発時にdocker compose logsで即座に確認するため)に加えて、
    Dockerの名前付きボリュームにマウントしたディレクトリ配下のファイルへ日次ローテーションで
    出力する。コンテナの再作成(リビルド・デプロイ)を挟んでもログ履歴が消えないようにするため。
    ローテーションは深夜0時に日付ファイルを切り替える方式(例: backend.log, backend.log.2026-08-25)で、
    保持世代数(日数)は設定で調整できる。
    """
    os.makedirs(settings.log_dir, exist_ok=True)
    log_path = os.path.join(settings.log_dir, settings.log_file_name)

    formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")

    file_handler = logging.handlers.TimedRotatingFileHandler(
        log_path,
        when=settings.log_rotation_when,
        backupCount=settings.log_rotation_backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(stream_handler)
