FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# リリース(release.yml、v*タグpush時)のビルドでのみgit tag名(例: v1.2.0)が渡される。
# ローカルビルド・PRのビルド確認では未指定のまま"dev"になり、設定画面の更新通知は
# 出ない(app/services/version_check_service.pyがdevの場合は比較自体をスキップする)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
