from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://unistock:unistock@localhost:5432/unistock"
    database_url_sync: str = "postgresql+psycopg2://unistock:unistock@localhost:5432/unistock"

    # リリース時(release.yml)のみDockerfileのARGとして実際のgit tag名(例: v1.2.0)が
    # 埋め込まれる。ローカルビルド・PRのビルド確認では未指定のまま"dev"になる
    app_version: str = "dev"

    base_client_id: str = ""
    base_client_secret: str = ""
    base_redirect_uri: str = "https://localhost/callback"
    base_api_base_url: str = "https://api.thebase.in"

    token_encryption_key: str = ""

    # ==== UniStock自体へのログイン(OIDC/OAuth) ====
    # falseにすると認証を完全にバイパスする(require_auth/require_adminが常に
    # 「管理者としてログイン中」扱いになる)。信頼できるネットワーク内でのみ公開する
    # 場合向け。インターネットに公開する構成ではtrueのまま使うこと
    auth_enabled: bool = True

    # ==== デモモード(外部ショップのアカウントを持たない第三者向けのスタンドアロン展示用) ====
    # 用語整理:「デモモード/通常モード」はこのフラグによる実行モード。「本番」は
    # ec_oauth_tokensに実際の連携トークンが存在するデータの状態のことで、モードとは
    # 独立した別概念(通常モードの中でも、本番化済みかまだセットアップ中かを区別する言葉)。
    # デモモードと本番は同じ永続化データ上で絶対に共存させない
    #
    # trueにすると、外部ショップ接続なし・ログイン不要で全機能を動かせるようになる。
    # auth_enabledとは完全に独立したフラグで、auth_enabled自体は書き換えない
    # (デモ終了→本番移行時に「認証無効化を戻し忘れる」リスクを避けるため)。
    # 有効時はBASEへの通信を一切行わずDemoECProviderに差し替わり、demo_seed_serviceで
    # 投入したデモデータのみで動作する。false→trueに切り替えた起動時には自動で
    # データを全消去してデモデータを再投入し(毎回真っさらな状態から始まる)、
    # true→falseに切り替えた起動時には自動でデータを全消去する(再投入はしない、
    # demo_mode_state.py)。true→true/false→falseのまま再起動(クラッシュ復帰等)
    # しても何もしない。
    #
    # 安全策: 本番状態(実トークンあり)でtrueを指定しても、demo_mode_state.pyが起動時に
    # 検知してデモモードでの起動そのものを拒否し、自動的にfalse(通常モード)へ強制する。
    # デモモード中はOAuth連携API(oauth.py)自体も塞いでいるため、デモモード中に本物の
    # トークンが新規発行されることも無い。本番からデモへ使い回したい場合は、
    # docker compose down -v 等で永続化データを完全に削除してから起動し直すこと
    # (アプリの機能としては用意しない)
    demo_mode: bool = False

    # ログインしたブラウザに配るセッションCookie(itsdangerous署名)用の秘密鍵。
    # BASE連携のtoken_encryption_keyとは別物
    session_secret_key: str = ""
    session_ttl_days: int = 30
    # ログイン成功後にリダイレクトするフロントエンドのオリジン(末尾スラッシュなし)
    frontend_base_url: str = "http://localhost:3000"
    # バックエンド自身の公開URL(各プロバイダのredirect_uri組み立てに使う。末尾スラッシュなし)
    backend_base_url: str = "http://localhost:8000"
    # 初回起動時にallowed_usersへ自動登録する管理者識別子(メールアドレス等)。
    # 空なら何もしない(既にDBにデータがある通常起動時を想定)
    initial_admin_identifier: str = ""

    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""
    x_client_id: str = ""
    x_client_secret: str = ""

    schedule_poll_interval_seconds: int = 30

    # 部品引当リトライジョブ(order_poller.enabledとは独立して常時稼働する)の実行間隔
    reservation_retry_interval_seconds: int = 300
    # 注文状態リチェックジョブ(sync()のwatermarkに乗らなくなった進行中の注文を、
    # unique_key指定で個別に再確認する。order_poller.enabledとは独立して常時稼働する)の実行間隔
    order_status_recheck_interval_seconds: int = 300
    # トランザクション系データの保持期間クリーンアップジョブの実行間隔
    retention_cleanup_interval_hours: int = 24

    # 商品カテゴリ同期ジョブの実行間隔。BASEのカテゴリ情報は商品ごとに個別リクエストでしか
    # 取得できず、かつ頻繁には変わらない想定のため、他の同期系ジョブより長い間隔を既定値とする
    item_category_sync_interval_hours: int = 6

    # 通知(Webhook/メール)機能の状態ベースチェック(発注点割れ・発注の納期超過・
    # 商品の作成可能数閾値割れ)の実行間隔
    notification_check_interval_seconds: int = 300

    # メール通知のSMTP接続情報。POSTGRES_PASSWORD/SESSION_SECRET_KEYと同様、
    # インフラ側の秘密情報として.envで管理し、DBには保存しない。未設定ならメール送信は無効
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""

    # 技術ログ(ファイル出力、Dockerの名前付きボリュームにマウントする想定)の設定
    log_dir: str = "/app/logs"
    log_file_name: str = "backend.log"
    log_rotation_when: str = "midnight"
    log_rotation_backup_count: int = 30


settings = Settings()
