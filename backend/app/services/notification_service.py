import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.app_setting_service import AppSettingService

logger = logging.getLogger(__name__)

EMAIL_ENABLED_KEY = "notification.email.enabled"
EMAIL_TO_KEY = "notification.email.to"

# プラットフォームごとにURLとJSONペイロードのキー名を個別に持つ(各Webhookの仕様を調査済み)。
# 1プラットフォームだけでなく、
# 設定済みの全プラットフォームへ同時に送る(例: Slackとdiscordの両方にURLを登録しておけば
# 両方に届く)。Teams(Workflows)はユーザー側でフローのマッピングを設定してもらう前提で、
# 他と同じtextキーで送る
_WEBHOOK_PAYLOAD_KEY = {
    "slack": "text",
    "mattermost": "text",
    "google_chat": "text",
    "teams": "text",
    "discord": "content",
}


def webhook_url_key(platform: str) -> str:
    return f"notification.webhook.{platform}.url"


APP_NAME = "UniStock"


def _enabled_key(category: str, channel: str) -> str:
    return f"notification.enabled.{category}.{channel}"


async def _is_channel_enabled(
    setting_service: AppSettingService, category: str, channel: str, shop_id: int | None
) -> bool:
    value = await setting_service.get_value_with_shop_fallback(_enabled_key(category, channel), shop_id, "false")
    return value == "true"


async def _post_webhook(platform: str, url: str, message: str) -> tuple[bool, str]:
    """1つのWebhook URLへ実際にPOSTする。通常通知(失敗を握りつぶす)とテスト送信
    (結果をユーザーに見せる)の両方から使う共通処理のため、ここでは例外を投げずに
    (成否, 理由)を返す。"""
    payload_key = _WEBHOOK_PAYLOAD_KEY.get(platform, "text")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={payload_key: message})
        if resp.status_code >= 300:
            return False, f"送信先がエラーを返しました(status={resp.status_code})"
        return True, "送信しました"
    except Exception as e:  # noqa: BLE001
        return False, f"送信できませんでした: {e}"


async def _send_webhook(
    setting_service: AppSettingService, category: str, message: str, shop_ids: list[int | None]
) -> None:
    """shop_idsに列挙された各ショップ(発注点割れのようにショップに紐づかないイベントの場合は
    有効な全ショップ+共通)ごとに、有効/無効・送信先をショップ別上書き→共通のフォールバックで
    解決する。解決結果が複数ショップで同じ送信先になることがある(全ショップが共通設定の
    ままの典型ケース等)ため、実際に届く(platform, url)の組は重複排除してから1回だけ送る。
    """
    destinations: set[tuple[str, str]] = set()
    for shop_id in shop_ids:
        if not await _is_channel_enabled(setting_service, category, "webhook", shop_id):
            continue
        for platform in _WEBHOOK_PAYLOAD_KEY:
            url = await setting_service.get_value_with_shop_fallback(webhook_url_key(platform), shop_id, "")
            if url:
                destinations.add((platform, url))

    for platform, url in destinations:
        success, reason = await _post_webhook(platform, url, message)
        if not success:
            logger.warning("Webhook通知の送信に失敗しました(platform=%s): %s", platform, reason)


async def _send_email_message(to_address: str, subject: str, message: str) -> tuple[bool, str]:
    """1通のメールを実際に送る。通常通知とテスト送信の両方から使う共通処理。"""
    if not settings.smtp_host or not settings.smtp_from_address:
        return False, "サーバーの.envにSMTP接続情報(SMTP_HOST等)が設定されていません"
    try:
        import aiosmtplib
        from email.message import EmailMessage

        email = EmailMessage()
        email["Subject"] = subject
        email["From"] = settings.smtp_from_address
        email["To"] = to_address
        email.set_content(message)

        await aiosmtplib.send(
            email,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user or None,
            password=settings.smtp_password or None,
            start_tls=True,
        )
        return True, "送信しました"
    except Exception as e:  # noqa: BLE001
        return False, f"送信できませんでした: {e}"


async def _send_email(
    setting_service: AppSettingService, category: str, subject: str, message: str, shop_ids: list[int | None]
) -> None:
    email_enabled = await setting_service.get_value(EMAIL_ENABLED_KEY, "false")
    if email_enabled != "true":
        return

    addresses: set[str] = set()
    for shop_id in shop_ids:
        if not await _is_channel_enabled(setting_service, category, "email", shop_id):
            continue
        to_address = await setting_service.get_value_with_shop_fallback(EMAIL_TO_KEY, shop_id, "")
        if to_address:
            addresses.add(to_address)

    for to_address in addresses:
        success, reason = await _send_email_message(to_address, subject, message)
        if not success:
            logger.warning("メール通知の送信に失敗しました: %s", reason)


_TEST_MESSAGE = "これはUniStockからのテスト通知です。この文言が届いていれば設定は正しく動作しています。"


async def send_test_webhook(platform: str, url: str) -> tuple[bool, str]:
    """設定画面の「テスト送信」ボタンから呼ばれる。保存前のURLでもその場でテストできるよう、
    AppSettingを経由せず渡されたURLへ直接送る。"""
    if not url:
        return False, "URLが未入力です"
    if platform not in _WEBHOOK_PAYLOAD_KEY:
        return False, f"未対応のプラットフォームです: {platform}"
    return await _post_webhook(platform, url, _TEST_MESSAGE)


async def send_test_email(to_address: str) -> tuple[bool, str]:
    if not to_address:
        return False, "メールアドレスが未入力です"
    return await _send_email_message(to_address, f"[{APP_NAME}] テスト通知", _TEST_MESSAGE)


async def notify(session: AsyncSession, category: str, message: str, shop_ids: list[int | None] | None = None) -> None:
    """業務イベントを、設定されたチャネル(Webhook/メール)へ通知する。

    カテゴリごとにWebhook/メールを個別にON/OFFできる(notification.enabled.<category>.<channel>)。
    このON/OFFも送信先と同様、ショップごとに上書きでき、無ければ共通設定にフォールバックする。

    shop_idsには「この通知が関係しうるショップのID一覧」を渡す。外部連携の認証エラーのように
    1つのショップに紐づくイベントなら`[shop_id]`(単一要素)、発注点割れのように部品在庫が
    全ショップ共有でどのショップの話でもないイベントなら、有効な全ショップのIDを渡す
    (呼び出し元で解決する)。省略時は`[None]`(常に共通設定のみを使う)。
    複数ショップを渡した場合、各ショップの解決結果(送信先)が重複することがあるため
    (例: 全ショップが共通設定のままの典型ケース)、実際の送信は重複排除してから行う。

    送信先自体が未設定ならトグルがONでも何もしない。送信失敗はここで握りつぶす
    (通知の失敗で呼び出し元の業務処理を止めないため、version_check_service.
    get_latest_releaseと同じ方針)。デモモードでは呼び出し元がそもそも呼ばない想定
    (main.py/各スケジューラーでガード)。
    """
    setting_service = AppSettingService(session)
    resolved_shop_ids = shop_ids if shop_ids else [None]

    await _send_webhook(setting_service, category, message, resolved_shop_ids)
    await _send_email(setting_service, category, f"[{APP_NAME}] {message.splitlines()[0]}", message, resolved_shop_ids)
