from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.shop import Shop
from app.providers.base import ECPlatform, IECProvider
from app.providers.base_ec import BaseECProvider
from app.providers.demo_ec import DemoECProvider
from app.providers.manual_ec import ManualECProvider
from app.services.token_service import TokenService


def build_provider(shop: Shop, session: AsyncSession) -> IECProvider:
    platform = ECPlatform(shop.platform)
    # デモモードでは、BASEの資格情報(TokenService)に一切触れないデモプロバイダに
    # 差し替える(デモ環境に誤ってトークンが残っていても使われないようにするため)。
    # 手動管理ショップはそもそも外部APIを一切呼ばないため、この安全策は不要。デモ
    # モードでもManualECProviderをそのまま使い、手動登録した商品(manual_items)が
    # 正しくBOM編集画面等に反映されるようにする
    if settings.demo_mode and platform != ECPlatform.MANUAL:
        return DemoECProvider(session)
    if platform == ECPlatform.BASE:
        return BaseECProvider(TokenService(session, shop.id))
    if platform == ECPlatform.MANUAL:
        return ManualECProvider(session, shop.id)
    raise NotImplementedError(f"{platform}は未実装です")
