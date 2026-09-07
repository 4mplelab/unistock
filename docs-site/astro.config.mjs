import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeBlack from "starlight-theme-black";

// frontendコンテナのnginxが同じオリジンの/docs配下でこのビルド成果物を配信する
// (アプリ本体とは別にホスティングせず、docker compose up だけで一緒に立ち上がる)
export default defineConfig({
  base: "/docs",
  integrations: [
    starlight({
      title: "UniStock ドキュメント",
      defaultLocale: "ja",
      locales: {
        root: { label: "日本語", lang: "ja" },
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/4mplelab/unistock" },
      ],
      plugins: [starlightThemeBlack({})],
      customCss: ["./src/styles/custom.css"],
      head: [
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" },
        },
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap",
          },
        },
      ],
      sidebar: [
        { label: "はじめに", slug: "index" },
        {
          label: "エンドユーザー向け",
          items: [
            { label: "ログイン", slug: "user-guide/login" },
            { label: "ヘッダーとナビゲーション", slug: "user-guide/header" },
            { label: "ダッシュボード", slug: "user-guide/dashboard" },
            { label: "部品・中間品", slug: "user-guide/parts" },
            { label: "BOM(商品レシピ)", slug: "user-guide/bom" },
            { label: "商品管理(手動)", slug: "user-guide/manual-items" },
            { label: "注文・ピッキング", slug: "user-guide/orders" },
            { label: "売上", slug: "user-guide/sales" },
            { label: "発注管理", slug: "user-guide/purchase-orders" },
            { label: "在庫スケジューラー", slug: "user-guide/schedules" },
            { label: "在庫変動履歴とイベントログ", slug: "user-guide/history" },
          ],
        },
        {
          label: "管理者向け",
          items: [
            { label: "初回セットアップウィザード", slug: "admin-guide/first-run" },
            { label: "ショップの管理", slug: "admin-guide/shops" },
            { label: "設定", slug: "admin-guide/settings" },
            { label: "デモモードとサンプルデータ", slug: "admin-guide/demo-mode" },
            { label: "ログイン方法の設定(OAuth)", slug: "admin-guide/login-setup" },
            { label: "本番デプロイとバックアップ", slug: "admin-guide/deployment" },
            { label: "開発者向け情報", slug: "admin-guide/development" },
          ],
        },
      ],
    }),
  ],
});
