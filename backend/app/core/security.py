from cryptography.fernet import Fernet

# 起動時(lifespan)にinit_fernet_keyで設定される。.envのTOKEN_ENCRYPTION_KEYが
# 未設定の場合は、DB(AppSetting)に永続化した自動生成キーが使われる
# (auth_service.ensure_token_encryption_key参照)
_fernet: Fernet | None = None


def init_fernet_key(key: str) -> None:
    global _fernet
    _fernet = Fernet(key)


def encrypt(value: str) -> str:
    if _fernet is None:
        raise RuntimeError("暗号化キーが初期化されていません(起動処理を確認してください)")
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if _fernet is None:
        raise RuntimeError("暗号化キーが初期化されていません(起動処理を確認してください)")
    return _fernet.decrypt(value.encode()).decode()
