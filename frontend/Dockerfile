# ビルドコンテキストはリポジトリルート(docs-siteを一緒にビルドするため)。
# docker compose up --build や scripts/build_and_push.sh から実行する分には
# 意識する必要はないが、`docker build` を直接叩く場合は
# `docker build -f frontend/Dockerfile .` のようにルートを指定すること

FROM node:20-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# アプリ本体とは別にドキュメントサイトをホスティングせず、同じnginxコンテナで
# /docs 配下に一緒に配信する(docker compose up だけで両方立ち上がるようにするため)。
# Astro 7はNode.js 22以上が必須のため、こちらのステージだけbuildより新しいイメージを使う
FROM node:22-slim AS docs-build
WORKDIR /docs-site
COPY docs-site/package.json docs-site/package-lock.json* ./
RUN npm install
COPY docs-site/ .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=docs-build /docs-site/dist /usr/share/nginx/html/docs
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
