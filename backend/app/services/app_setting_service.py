from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting


class AppSettingService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def list_all(self) -> list[AppSetting]:
        result = await self._session.execute(select(AppSetting).order_by(AppSetting.key))
        return list(result.scalars().all())

    async def get_value(self, key: str, default: str) -> str:
        setting = await self._session.get(AppSetting, key)
        return setting.value if setting is not None else default

    async def get_value_with_shop_fallback(self, key: str, shop_id: int | None, default: str) -> str:
        """`{key}.{shop_id}`(ショップ専用の上書き)が空でなければそれを、無い(または空文字)
        なら`{key}`(共通設定)を返す。shop_idがNoneの場合は共通設定のみを見る。
        通知の送信先・有効/無効トグルのように、ショップごとに上書きできるが必須ではない
        設定に使う。空文字を「未設定=共通設定を使う」の意味にすることで、フロント側で
        フィールドを空に戻すだけで共通設定への継承に戻せる(行の削除エンドポイントを
        別途持たなくて済む)。
        """
        if shop_id is not None:
            shop_setting = await self._session.get(AppSetting, f"{key}.{shop_id}")
            if shop_setting is not None and shop_setting.value != "":
                return shop_setting.value
        return await self.get_value(key, default)

    async def set(self, key: str, value: str) -> AppSetting:
        setting = await self._session.get(AppSetting, key)
        if setting is None:
            setting = AppSetting(key=key, value=value)
            self._session.add(setting)
        else:
            setting.value = value
        await self._session.commit()
        await self._session.refresh(setting)
        return setting

    async def set_default(self, key: str, value: str) -> None:
        """未設定(行が存在しない)場合のみ値を書き込む。ユーザーが明示的に設定済みなら上書きしない。"""
        setting = await self._session.get(AppSetting, key)
        if setting is None:
            self._session.add(AppSetting(key=key, value=value))
            await self._session.commit()
