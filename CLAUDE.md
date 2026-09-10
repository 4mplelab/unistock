# UniStock 開発ルール

## ドキュメントサイトの同期

`docs-site/`(Astro Starlight、`/docs`配下でfrontendコンテナと一緒に配信)は、UniStockの主要画面(部品・中間品、BOM、注文・ピッキング、発注管理、在庫スケジューラー、ショップ設定、設定)の詳しい使い方を説明している。

**仕様・機能・UI文言に変更が入ったら、`docs-site/src/content/docs/`配下の該当ページも更新すること。**

- タイミング: 変更のたびに逐一更新するのではなく、一連の作業がある程度全て終わってから(セッションの区切りやまとまった変更が固まった時点で)まとめて反映する
- UIラベル・文言をドキュメントに書く際は、記憶や推測で書かず、必ず実際のコード(該当コンポーネントのJSX/label文言)を確認してから書く(過去に「発注可能」という架空のラベルを書きかけ、実際は「発注管理する」だったことがある)
- スクリーンショットが古くなった場合(画面の見た目が大きく変わった等)は、可能なら実機で撮り直す(`docs-site/public/screenshots/`)
- 更新後は`cd docs-site && npm run build`でビルドが通ることを確認する

## READMEから直接リンクするdocs-siteページはStarlight専用コンポーネント禁止

`README.md`は「アプリを起動する前に読む」ドキュメント(OAuthログイン設定・本番デプロイ・開発者向け情報など)を、`docs-site/src/content/docs/admin-guide/`配下のファイルへ相対パスで直接リンクしている(GitHub上でクローン前でもそのまま読めるようにするため)。

**このようにREADMEから直接リンクするページは、`<Steps>` `<Tabs>` `<Aside>` `<CardGrid>` `<FlowDiagram>` 等のStarlight専用コンポーネント(`@astrojs/starlight/components`からのimportや自作`.astro`コンポーネント)を使わず、見出し・番号付きリスト・コードブロック・引用(`>`)だけの素のMarkdownで書くこと。** GitHubの静的レンダリングはこれらのカスタムタグを解釈できず、アプリを起動していない読者には壊れて見える(実際に`login-setup.mdx`で発生した)。

- 対象: 現状`admin-guide/login-setup.mdx`・`admin-guide/deployment.mdx`・`admin-guide/development.mdx`(README末尾からリンクしている3ページ)
- 上記以外(ダッシュボード・売上・BOM等、実機のスクリーンショットを使うページ)はアプリ起動前提のため対象外。Starlightコンポーネントを自由に使ってよい

## 安全面

通常モード(`DEMO_MODE=false`)でBASEに実際の書き込み・通知送信が起きる操作(リストック予約実行・注文操作・発送確定等)は、動作確認のためであっても実行しない。デモモードの範囲内で検証する。

## 開発ワークフロー

- ローカルでのソース変更確認は`docker-compose.dev.yml`を使う。これは単独では使えない**差分ファイル**で、本番/配布用の`docker-compose.yml`(ビルド済みイメージをpull)に重ねて`docker compose -f docker-compose.yml -f docker-compose.dev.yml ...`のように指定する(backend/frontendだけソースビルドに差し替え、db等は`docker-compose.yml`の定義をそのまま使う)。backend/frontendはソースをイメージに焼き込む構成(bind mountなし)のため、コード変更後は`docker compose -f docker-compose.yml -f docker-compose.dev.yml build <service> && up -d <service>`が必要(ホットリロードされない)。ローカルで直接起動する場合(`uvicorn --reload`/`npm run dev`)はホットリロードされる
- 新しいUIラベル・ボタン文言・画面構成を書く前に、類似の既存画面のコードを確認してから合わせる

## 確立済みのUI規約

- 行アクションは右端sticky `⋮`メニュー
- ホバーヒントはネイティブ`title=`でなく`Hint.tsx`
- 必須項目はアスタリスク表示、任意項目への注記はしない
- 部品/中間品選択は`ItemCombobox`/`ComponentCombobox`、ネイティブ`<select>`は使わない
- ダイアログ・ボタン等のUI文言はユーザー視点で書く。内部でどう処理しているか(「計算し直す」「BOM設定に基づいて」等の実装都合の説明)は画面に出さない。ユーザーが知るべきは「何が起きるか」「次に何をすべきか」だけで、処理方法の共有が必要ないなら書かない。また既存の在庫用語(`在庫`=stock、`引当`=reserved。「実在庫」「予約数」のような言い換えは作らない)に必ず揃える

## OSS化に伴う注意

コード内コメントに個人的な参照や実データを残さない。汎用的な例に置き換える。
