# UniStock

[![Build Check](https://github.com/4mplelab/unistock/actions/workflows/build-check.yml/badge.svg)](https://github.com/4mplelab/unistock/actions/workflows/build-check.yml)
[![License: MIT](https://img.shields.io/github/license/4mplelab/unistock)](LICENSE)
[![Release](https://img.shields.io/github/v/release/4mplelab/unistock)](https://github.com/4mplelab/unistock/releases)
[![Top Language](https://img.shields.io/github/languages/top/4mplelab/unistock)](#技術構成)

複数のECプラットフォームに対応可能な設計の、在庫・注文・部品の統合管理Webアプリです。  
現在は`BASE`と、外部連携APIを持たないサイト向けの`手動管理`ショップ(商品・注文を手動登録で運用)に対応。

各画面の詳しい使い方は、起動後にアプリのヘッダーにある「?」アイコンから開けるドキュメントサイトを参照してください。  
**このREADMEは、Dockerだけで動かすための最小限のセットアップ手順です。**

## 主な機能

| 機能 | 概要 |
|---|---|
| 部品・中間品管理 | 在庫数・発注点・タグ・購入先URLを一元管理。中間品はレシピと組立記録を持つ |
| BOM(商品レシピ) | 商品ごとの部品消費レシピ。オプション・バリエーション・複数条件の組み合わせに対応 |
| 注文・在庫引当 | 注文検知→仮引当→発送時消費→キャンセル時解除を自動化。ピッキング管理・PDF出力にも対応 |
| 発注管理 | 発注点割れの一覧表示・発注記録・入荷処理 |
| 通知 | Webhook(Slack/Discord/Mattermost/Google Chat/Teams)・メールで業務イベントを通知 |
| 在庫スケジューラー | 指定日時にショップの在庫数を自動更新 |
| 複数ショップ | 複数プラットフォーム・複数ショップを横断運用。部品在庫は一元管理 |
| 手動管理ショップ | 外部連携APIを持たないサイト向けに、手動フォーム・CSVインポートで運用 |
| 売上・原価・粗利 | 発送確定した注文から自動集計。日別推移・商品別・カテゴリ別のグラフとランキング |
| デモモード | 外部ショップ接続・ログインなしで全機能をそのまま試せる |
| ログイン | Google/Microsoft/GitHub/X、許可ユーザー管理、APIキーによる外部連携 |

## 必要なもの

[Docker Desktop](https://www.docker.com/products/docker-desktop/)(Docker Compose込み。Windows/Mac/Linuxいずれか)だけです。  
ビルド済みイメージをpullして使うため、Python/Node.js等のインストールも、このリポジトリのクローンも不要です。

インストール後、Docker Desktopを起動しておいてください。  
(以下のコマンドを実行する前に、アプリが起動して稼働中の状態になっている必要があります)

## クイックスタート: デモモードで試す

もっとも手軽に試す方法です。  
ECサイトのアカウントもログイン用の設定も一切不要です。

以下のコマンドは、ターミナル(Mac)またはコマンドプロンプト(Windows)を開いて実行してください。

- **macOS**: Spotlight検索で「ターミナル」と入力すると開けます
- **Windows**: スタートメニューで「コマンドプロンプト」と検索して開いてください。  
  (**PowerShellではありません**。  `curl`コマンドの挙動が異なり、この手順が失敗します)

1. 空のフォルダを作り、設定ファイルを2つダウンロードする

   ```bash
   mkdir unistock && cd unistock
   curl -O https://raw.githubusercontent.com/4mplelab/unistock/main/docker-compose.yml
   curl -o .env https://raw.githubusercontent.com/4mplelab/unistock/main/.env.example
   ```

2. `.env`をテキストエディタで開き、`DEMO_MODE=true`にする(他の項目はそのままでOK)

3. イメージをpullして起動する

   ```bash
   docker compose pull
   docker compose up -d
   ```

4. ブラウザで`http://{localhost または 端末IP}:3000`を開く。  
   「デモを試す」ボタン→セットアップウィザードでショップを作成する。  
   「デモ用のサンプルデータを投入する」にチェックすると、部品・BOM・注文・発注等が入った状態で試せる。

## 通常モードで運用する場合

上記と同じ2ファイルを使います。  
(すでにデモモードで試し済みなら、新しく用意せず同じ`.env`を編集するだけでOK)

1. `.env`を編集する
   - `DEMO_MODE=false`(未指定時のデフォルト)
   - `BASE_CLIENT_ID` / `BASE_CLIENT_SECRET`: BASEショップを使う場合のみ。[BASE Developers](https://developers.thebase.in)で取得
   - **UniStock自体へのログイン設定**
     - 不要なら`AUTH_ENABLED=false`
     - 必須にする場合は事前設定が必要([ログイン方法の設定](docs-site/src/content/docs/admin-guide/login-setup.mdx)参照)

2. (再)起動する

   ```bash
   docker compose up -d
   ```

3. ブラウザで`http://{localhost または 端末IP}:3000`を開き、手順1で設定したアカウントでログインする。  
   > [!NOTE]
   > `AUTH_ENABLED=false`ならログイン不要。  
   > 最初にログインした人が自動的に管理者になります。

4. セットアップウィザードでショップを作成する。  
   BASEショップを選んだ場合は、作成後に画面の案内に沿ってBASEとの連携(OAuth)を行う。  
   手動管理ショップの場合は、そのまま商品・注文を登録できる。

> [!NOTE]
> 各画面の使い方は、実際にアプリを起動してヘッダーの「?」アイコンから開くドキュメントサイトを参照してください。  
> (起動中のUniStock自身の中にあるページのため、このREADMEからは直接開けません)

## 技術構成

| レイヤー | 技術 |
|---|---|
| バックエンド | FastAPI (Python) |
| フロントエンド | React + TypeScript (Vite SPA) |
| DB | PostgreSQL |
| インフラ | Docker Compose(FastAPI / React+nginx / PostgreSQL / DB日次バックアップの4コンテナ) |

## その他

- 複数台のサーバーでの継続運用・アップデート・DBバックアップは[本番デプロイとバックアップ](docs-site/src/content/docs/admin-guide/deployment.mdx)を参照
- ソースコードを触る・機能追加する場合は[開発者向け情報](docs-site/src/content/docs/admin-guide/development.mdx)を参照(この場合のみリポジトリのクローンが必要です)
- Claude Desktop/Claude CodeなどからUniStockのデータを参照したい場合は[MCPサーバー](mcp-server/README.md)を参照(現状は読み取り専用)

## ライセンス

[MIT License](LICENSE)
