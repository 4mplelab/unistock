#!/usr/bin/env bash
# ローカルMacでbackend/frontendイメージをlinux/amd64向けにビルドし、
# GitHub Container Registry(ghcr.io)にpushする。通常はv*タグのpushで自動実行される
# .github/workflows/release.yml に任せればよく、このスクリプトは手元で
# 動作確認したい場合や、CIを使わず手動でpushしたい場合向け。
# デプロイ先はx86_64サーバーを想定しているため、Apple SiliconのMacでも明示的にamd64を指定してビルドする。
# 事前に `docker login ghcr.io -u <GitHubユーザー名>` (Personal Access Token、write:packagesスコープ)
# を済ませておくこと。
#
# 使い方: ./scripts/build_and_push.sh [タグ名(省略時 latest)]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="linux/amd64"

# .env の REGISTRY_PATH を読み込む
if [ -f "$ROOT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

if [ -z "${REGISTRY_PATH:-}" ]; then
  echo "エラー: REGISTRY_PATH が未設定です。.env に設定してください(例: ghcr.io/4mplelab/unistock)" >&2
  exit 1
fi

TAG="${1:-latest}"

echo "==> backend をビルド・push中 (tag: $TAG, platform: $PLATFORM)"
docker buildx build --platform "$PLATFORM" -t "$REGISTRY_PATH/backend:$TAG" "$ROOT_DIR/backend" --push

echo "==> frontend をビルド・push中 (tag: $TAG, platform: $PLATFORM)"
# docs-site(Astro Starlight)を/docsとして一緒にビルドするため、コンテキストは
# リポジトリルート・Dockerfileはfrontend/配下を明示指定する
docker buildx build --platform "$PLATFORM" -f "$ROOT_DIR/frontend/Dockerfile" -t "$REGISTRY_PATH/frontend:$TAG" "$ROOT_DIR" --push

echo "==> 完了: $REGISTRY_PATH/{backend,frontend}:$TAG ($PLATFORM)"
