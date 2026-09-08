# UniStock MCP サーバー

UniStockの在庫・注文・発注・売上データを、Claude Desktop / Claude Code / Cursorなど
MCP対応のAIクライアントから参照・操作できるようにするサーバーです。

UniStockの既存REST APIを、APIキー(Bearer認証)付きのHTTPリクエストで呼ぶだけの薄い
ラッパーで、UniStock本体のDBには直接触れません。書き込み系ツールもAPIキー
(`require_auth`)で通る範囲のみで、ショップ削除等の管理者専用操作は含みません。
詳細は「提供ツール一覧」を参照。

動かし方は2通りあります。

- **リモート型(推奨)**: UniStock本体と同じDocker Compose内に常時起動のサービスとして
  動かす。使う端末ごとにPython環境を用意する必要がなく、どの端末からでもネットワーク
  経由で接続できる
- **ローカル型**: AIアプリ(Claude Desktop等)が自分のPC上でプロセスとして起動する方式。
  UniStockをDocker化していない場合や、1台のPCだけで完結させたい場合向け

## リモート型(Docker常駐)のセットアップ

1. `UNISTOCK_API_KEY`の値を用意する。この1つの値を、このMCPサーバーへの接続と、
   UniStock API呼び出しの両方に使う。

   - UniStockが**AUTH_ENABLED=true**(通常のログイン運用)の場合: 設定画面(管理者で
     ログイン)→「APIキー」から、このMCPサーバー専用のキーを新規発行する(名前は
     `mcp-server`など分かりやすいものに)。発行直後にしか表示されない値なので、
     その場で控えておく
   - UniStockが**AUTH_ENABLED=false**(認証なし運用)の場合: UniStock API自体が
     認証チェックをしないため「APIキー」画面は出ない。代わりに、任意の秘密文字列を
     自分で決める(例: `openssl rand -hex 32`の出力)。UniStock側には送っても
     無視されるだけで、このMCPサーバー自体への接続保護としてのみ機能する

2. リポジトリルートの`.env`に設定する。

   ```bash
   MCP_API_KEY=手順1で用意した値
   MCP_SERVER_PORT=8765
   ```

3. `mcp-server`コンテナを起動する(backend/frontendと同じくビルド済みイメージをpullするだけ。
   UniStockをまだ起動していなければ`docker compose up -d`で全体を起動しても良い)。

   ```bash
   docker compose pull mcp-server
   docker compose up -d mcp-server
   ```

4. 設定ファイルに追加する。

   **Claude Code**は`.mcp.json`やCLIでリモート(HTTP)サーバーをそのまま扱える。

   ```bash
   claude mcp add --transport http unistock http://UniStockを動かしているマシンのIP:8765/mcp \
     --header "Authorization: Bearer 手順1で用意した値"
   ```

   ```json
   {
     "mcpServers": {
       "unistock": {
         "command": "npx",
         "args": [
           "mcp-remote",
           "http://UniStockを動かしているマシンのIP:8765/mcp",
           "--allow-http",
           "--header",
           "Authorization: Bearer 手順1で用意した値"
         ]
       }
     }
   }
   ```

   `https://`の場合は`--allow-http`不要。

## ローカル型(AIアプリがプロセス起動)のセットアップ

ローカル型はAIアプリがそのマシン上でプロセスを直接起動する方式のためネットワークに
公開されず、`UNISTOCK_API_KEY`は省略可能(UniStockが`AUTH_ENABLED=true`の場合のみ
必要)。

1. UniStockが**AUTH_ENABLED=true**の場合のみ、上記と同様にAPIキーを発行する
   (falseの場合は「APIキー」画面自体が無いため、この手順は丸ごと不要)。
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
           "UNISTOCK_API_KEY": "発行したAPIキー(AUTH_ENABLED=falseなら省略可)"
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
| `UNISTOCK_API_KEY` | このMCPサーバーへの接続と、UniStock API呼び出しの両方に使う値。`MCP_TRANSPORT=streamable-http`時は必須、`stdio`時は省略可(省略時はAuthorizationヘッダーを付けずにUniStock APIを呼ぶ) |
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

## 提供ツール一覧(書き込み系)

BASEには一切書き込まず、UniStock内部で完結する操作のみ含む。例外は`create_restock_schedule`だけで、指定日時にBASE等への在庫反映が発生しうる。

| ツール名 | 内容 |
|---|---|
| `create_purchase_order` / `receive_purchase_order` / `undo_receive_purchase_order` / `cancel_purchase_order` | 発注の登録・入荷・入荷取消・キャンセル |
| `update_dispatch_status` / `undo_dispatch` | 注文の発送確定・取消。**手動ショップ(外部EC非連携)限定**。BASE連携ショップの注文には使えない(バックエンド側の制約により拒否される) |
| `create_part` / `add_part_stock` | 部品の新規登録・在庫加算 |
| `create_assembly` / `replace_assembly_recipe` / `build_assembly` | 中間品の新規登録・レシピ置換・組み立て |
| `create_bom_item` / `update_bom_item` | 商品のBOM行の追加・数量更新 |
| `create_restock_schedule` | リストック予約の作成。実行予定時刻が12時間以内の場合、`confirm=true`を明示しない限り作成されず、確認を促すメッセージを返す |
| `cancel_restock_schedule` | 未実行のリストック予約のキャンセル |

## 注意事項

- APIキーによる認証はUniStockの`require_auth`相当までしか通らず、ショップ削除・
  全データ削除・原価再計算・ユーザー/APIキー管理など管理者専用の操作(`require_admin`)
  はAPIキーでは実行できない(UniStock側の仕様、AUTH_ENABLED=trueの場合)。ただし
  本サーバーは読み取り専用ツールしか提供していないため、現状この境界には依存していない
- リモート型はネットワーク経由で到達可能になるため、インターネットに直接公開せず、
  信頼できるネットワーク内(自宅LAN・VPN経由等)での利用を前提にしている
- UniStockが`AUTH_ENABLED=false`(認証なし運用)の場合、UniStock API自体は誰からの
  リクエストも受け付けてしまう。このMCPサーバーの`UNISTOCK_API_KEY`による防御は、
  あくまで「このMCPサーバー経由でのアクセス」だけを絞るものであり、UniStock API
  そのものへの直接アクセスは制限できない点に注意
- 使わなくなったら、UniStock設定画面の「APIキー」からいつでも失効できる(リモート型は
  失効した瞬間、UniStock API呼び出しとこのMCPサーバーへの接続の両方が401になる。
  AUTH_ENABLED=falseの場合は自分で決めた文字列を`.env`から削除・変更するだけでよい)
