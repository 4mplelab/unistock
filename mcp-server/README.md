# UniStock MCP サーバー

UniStockの在庫・注文・発注・売上データを、Claude Desktop / Claude Code / Cursorなど
MCP対応のAIクライアントから参照できるようにするサーバーです。

現時点では**読み取り専用**です(在庫を減らす・発注する等の書き込み操作は含みません)。
UniStockの既存REST APIを、APIキー(Bearer認証)付きのHTTPリクエストで呼ぶだけの薄い
ラッパーで、UniStock本体のDBには直接触れません。

動かし方は2通りあります。

- **リモート型(推奨)**: UniStock本体と同じDocker Compose内に常時起動のサービスとして
  動かす。使う端末ごとにPython環境を用意する必要がなく、どの端末からでもネットワーク
  経由で接続できる
- **ローカル型**: AIアプリ(Claude Desktop等)が自分のPC上でプロセスとして起動する方式。
  UniStockをDocker化していない場合や、1台のPCだけで完結させたい場合向け

## リモート型(Docker常駐)のセットアップ

1. UniStockの設定画面(管理者でログイン)→「APIキー」から、このMCPサーバー専用の
   キーを新規発行する(名前は`mcp-server`など分かりやすいものにしておく)。
   発行直後にしか表示されない値なので、その場で控えておくこと。
2. リポジトリルートの`.env`に、発行したキーとポート(既定8765)を設定する。

   ```bash
   MCP_API_KEY=発行したAPIキー
   MCP_SERVER_PORT=8765
   ```

3. `mcp-server`コンテナを起動する(backend/frontendと同じくビルド済みイメージをpullするだけ。
   UniStockをまだ起動していなければ`docker compose up -d`で全体を起動しても良い)。

   ```bash
   docker compose pull mcp-server
   docker compose up -d mcp-server
   ```

4. Claude Desktopの設定ファイル(macOSなら
   `~/Library/Application Support/Claude/claude_desktop_config.json`)に追加する。

   ```json
   {
     "mcpServers": {
       "unistock": {
         "url": "http://UniStockを動かしているマシンのIP:8765/mcp",
         "headers": {
           "Authorization": "Bearer 発行したAPIキー"
         }
       }
     }
   }
   ```

   Claude Codeの場合はコマンドで追加する。

   ```bash
   claude mcp add --transport http unistock http://UniStockを動かしているマシンのIP:8765/mcp \
     --header "Authorization: Bearer 発行したAPIキー"
   ```

   保存後、Claude Desktopは再起動する。チャット入力欄近くのツールアイコンから、
   UniStockのツール(`list_parts`等)が読み込まれていることを確認する。

   `MCP_API_KEY`と同じ値を、このMCPサーバー自体への接続認証にも要求する(UniStock API
   呼び出し用の鍵を再利用しているだけで、別の秘密情報を増やす必要はない)。ヘッダーが
   無い/違う場合は401を返す。

## ローカル型(AIアプリがプロセス起動)のセットアップ

1. 上記と同様にAPIキーを発行する。
2. このディレクトリで仮想環境を作り、依存関係をインストールする。

   ```bash
   cd mcp-server
   python3 -m venv venv
   source venv/bin/activate   # Windowsは venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Claude Desktopの設定ファイルに追加する。

   ```json
   {
     "mcpServers": {
       "unistock": {
         "command": "/path/to/unistock/mcp-server/venv/bin/python",
         "args": ["/path/to/unistock/mcp-server/server.py"],
         "env": {
           "UNISTOCK_API_BASE_URL": "http://localhost:8000/api",
           "UNISTOCK_API_KEY": "発行したAPIキー"
         }
       }
     }
   }
   ```

   Claude Codeの場合はコマンドで追加する。

   ```bash
   claude mcp add unistock \
     --env UNISTOCK_API_BASE_URL=http://localhost:8000/api \
     --env UNISTOCK_API_KEY=発行したAPIキー \
     -- /path/to/unistock/mcp-server/venv/bin/python /path/to/unistock/mcp-server/server.py
   ```

## 環境変数

| 変数 | 内容 |
|---|---|
| `UNISTOCK_API_BASE_URL` | UniStock backendのAPI URL。既定値`http://localhost:8000/api`。Docker運用時は`http://backend:8000/api`(docker-compose.ymlで設定済み) |
| `UNISTOCK_API_KEY` | UniStockの設定画面で発行したAPIキー(必須) |
| `MCP_TRANSPORT` | `stdio`(既定、ローカル型)または`streamable-http`(リモート型。docker-compose.ymlで設定済み) |
| `MCP_HTTP_HOST` | `streamable-http`時の待受ホスト(既定`0.0.0.0`) |
| `MCP_HTTP_PORT` | `streamable-http`時の待受ポート(既定`8765`) |

## 提供ツール一覧(読み取り専用)

| ツール名 | 内容 |
|---|---|
| `list_shops` | 連携中ショップの一覧 |
| `list_parts` | 部品一覧(在庫・発注点等) |
| `get_part` | 部品1件の詳細 |
| `list_reorder_needed` | 発注点を下回っている部品 |
| `list_assemblies` | 中間品一覧 |
| `list_buildable_assemblies` | 中間品ごとの追加組み立て可能数 |
| `list_bom_products` | 商品ごとのBOM(構成部品)一覧 |
| `list_orders` | 注文一覧 |
| `get_order` | 注文1件の明細 |
| `list_purchase_orders` | 発注一覧 |
| `get_sales_summary` | 売上・原価・粗利のサマリ(商品別ランキング・カテゴリ別内訳込み)。`start_date`/`end_date`で任意の期間(暦月等)を指定可能、省略時は直近`days`日間 |

## 注意事項

- APIキーによる認証はUniStockの`require_auth`相当までしか通らず、ショップ削除・
  全データ削除・原価再計算・ユーザー/APIキー管理など管理者専用の操作(`require_admin`)
  はAPIキーでは実行できない(UniStock側の仕様)。ただし本サーバーは読み取り専用
  ツールしか提供していないため、現状この境界には依存していない
- リモート型はネットワーク経由で到達可能になるため、インターネットに直接公開せず、
  信頼できるネットワーク内(自宅LAN・VPN経由等)での利用を前提にしている
- 使わなくなったら、UniStock設定画面の「APIキー」からいつでも失効できる(リモート型は
  失効した瞬間、UniStock API呼び出しとこのMCPサーバーへの接続の両方が401になる)
