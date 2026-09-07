import re

# 住所文字列の先頭から「市」「区」「町」「村」のいずれかが最初に現れる位置までを
# 市区町村レベルとみなして切り出す(非貪欲マッチ)。政令指定都市の区(例: 千葉市緑区)は
# 最初の「市」で止まるため区より上のレベルに丸められ、東京23区(例: 港区)は区自体が
# 市区町村レベルなのでそのまま残る。番地・建物名等はBASE側でaddress2に分離されている
# 想定だが、購入者がaddressへ番地まで自由入力するケースもあるため、この切り詰めは
# アプリ側の最終防衛としても機能する。
_MUNICIPALITY_RE = re.compile(r"^.+?[市区町村]")


def truncate_address_to_city(address: str | None) -> str | None:
    """住所を市区町村レベルまでに切り詰める。境界を判定できない場合は安全側に倒し、
    住所ごとNoneにする(都道府県のみが残る)。"""
    if not address:
        return None
    match = _MUNICIPALITY_RE.match(address)
    return match.group(0) if match else None
