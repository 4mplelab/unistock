"""UniStockの既存REST APIをMCPツールとして公開するサーバー。

DBには一切触れず、UniStockの稼働中インスタンスにHTTPリクエストするだけの薄い
ラッパー。書き込み系ツールはAPIキー(require_auth)で通る範囲のみで、
ショップ削除・全データ削除・原価再計算・ユーザー/APIキー管理等の管理者専用操作
(require_admin)は含まない。またBASE等の外部ECへ実際に書き込みうる操作は
リストック予約の作成(create_restock_schedule)のみで、実行予定が近い場合は
確認ステップを挟む。注文の発送確定/キャンセルは手動ショップ(外部EC非連携)限定で、
BASE連携ショップの注文には使えない(バックエンド側の制約)。

環境変数:
  UNISTOCK_API_BASE_URL  例: http://localhost:8000/api (既定値)
  UNISTOCK_API_KEY       このMCPサーバーへの接続と、UniStock API呼び出しの両方に使う
                          単一の値。UniStock側がAUTH_ENABLED=trueなら設定画面「APIキー」
                          から発行した値を、falseなら任意の秘密文字列を自分で決めて設定
                          する(falseの場合UniStock APIには送っても無視されるだけで、
                          このMCPサーバー自体への接続保護としてのみ機能する)。
                          MCP_TRANSPORT=streamable-http時は必須、stdio時は省略可
  MCP_TRANSPORT          stdio(既定、AIアプリがローカルでプロセス起動する方式)
                          または streamable-http(常時起動のWebサービスとして動かし、
                          ネットワーク越しに接続する方式。Docker運用向け)
  MCP_HTTP_HOST          streamable-http時の待受ホスト(既定 0.0.0.0)
  MCP_HTTP_PORT          streamable-http時の待受ポート(既定 8765)
"""

import os
from datetime import datetime, timezone
from typing import Any

import httpx
from mcp.server.mcpserver import MCPServer

API_BASE_URL = os.environ.get("UNISTOCK_API_BASE_URL", "http://localhost:8000/api")
API_KEY = os.environ.get("UNISTOCK_API_KEY") or None
TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")
HTTP_HOST = os.environ.get("MCP_HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.environ.get("MCP_HTTP_PORT", "8765"))

if TRANSPORT == "streamable-http" and not API_KEY:
    raise RuntimeError("MCP_TRANSPORT=streamable-httpではUNISTOCK_API_KEYの設定が必須です")

mcp = MCPServer("UniStock")


async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=10.0) as client:
        response = await client.get(
            path,
            params={k: v for k, v in (params or {}).items() if v is not None},
            headers=headers,
        )
        response.raise_for_status()
        return response.json()


async def _write(method: str, path: str, json: dict[str, Any] | None = None) -> Any:
    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
    body = {k: v for k, v in (json or {}).items() if v is not None}
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=10.0) as client:
        response = await client.request(method, path, json=body, headers=headers)
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except ValueError:
                detail = response.text
            return {"error": detail, "status_code": response.status_code}
        return response.json() if response.content else {"ok": True}


@mcp.tool()
async def list_shops() -> Any:
    """連携中のショップ一覧を取得する(id・名前・プラットフォーム・有効/無効)。
    他のツールにshop_idを渡す前に、まずこれでIDを確認する。"""
    return await _get("/shops")


@mcp.tool()
async def list_parts() -> Any:
    """部品一覧を取得する(在庫数・引当数・利用可能数・発注点・発注中数量など)。
    全ショップ共有の在庫マスタ(shop_idでの絞り込みはない)。"""
    return await _get("/parts")


@mcp.tool()
async def get_part(part_id: int) -> Any:
    """指定した部品1件の詳細を取得する。"""
    return await _get(f"/parts/{part_id}")


@mcp.tool()
async def list_reorder_needed() -> Any:
    """発注点を下回っている部品の一覧を取得する(発注が必要な部品を確認する用途)。"""
    return await _get("/purchase-orders/reorder-needed")


@mcp.tool()
async def list_assemblies() -> Any:
    """中間品(半製品)一覧を取得する(在庫数・引当数など)。"""
    return await _get("/assemblies")


@mcp.tool()
async def list_buildable_assemblies() -> Any:
    """各中間品について、現在の材料在庫から追加で組み立てられる数を取得する。"""
    return await _get("/assemblies/buildable-available")


@mcp.tool()
async def list_bom_products(shop_id: int, search: str | None = None, limit: int = 20, offset: int = 0) -> Any:
    """指定ショップの商品ごとのBOM(構成部品)一覧を取得する。searchで商品名を絞り込める。"""
    return await _get("/bom/products", {"shop_id": shop_id, "search": search, "limit": limit, "offset": offset})


@mcp.tool()
async def list_orders(
    shop_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
    include_cancelled: bool = True,
) -> Any:
    """注文一覧を取得する(新しい順)。shop_id省略で全ショップ横断。"""
    return await _get(
        "/orders",
        {"shop_id": shop_id, "limit": limit, "offset": offset, "include_cancelled": include_cancelled},
    )


@mcp.tool()
async def get_order(order_id: int) -> Any:
    """指定した注文1件の明細(商品・数量・オプション・金額等)を取得する。"""
    return await _get(f"/orders/{order_id}")


@mcp.tool()
async def list_purchase_orders(
    status: str | None = None,
    shop_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> Any:
    """発注一覧を取得する。status指定で絞り込み可能(ordered/received/cancelled)。"""
    return await _get(
        "/purchase-orders",
        {"status": status, "shop_id": shop_id, "limit": limit, "offset": offset},
    )


@mcp.tool()
async def get_sales_summary(
    shop_id: int | None = None,
    days: int = 30,
    start_date: str | None = None,
    end_date: str | None = None,
    date_basis: str = "dispatched",
) -> Any:
    """売上・原価・粗利のサマリを取得する。1回の呼び出しで、総額(売上/原価/粗利/粗利率)・
    日別推移・商品別ランキング・カテゴリ別内訳(カテゴリごとの商品内訳込み)がまとめて返る。

    期間はstart_date/end_date(YYYY-MM-DD、両端含む、例: 2026年1月なら
    start_date="2026-01-01" end_date="2026-01-31")を指定するとその期間で集計する。
    両方とも省略した場合のみ、daysで「今日から何日前まで」のローリング期間になる
    (start_date/end_dateを指定した場合、daysは無視される)。

    date_basis="dispatched"(既定)は発送確定日基準(実績として確定した日)、"ordered"は
    注文日基準(需要が発生した日、直近日は未発送分が反映されずやや少なく出る)。
    shop_id省略で全ショップ合算。"""
    return await _get(
        "/sales/summary",
        {
            "shop_id": shop_id,
            "days": days,
            "start_date": start_date,
            "end_date": end_date,
            "date_basis": date_basis,
        },
    )


@mcp.tool()
async def create_purchase_order(
    part_id: int,
    shop_id: int,
    quantity: int,
    note: str | None = None,
    expected_delivery_date: str | None = None,
    order_url: str | None = None,
) -> Any:
    """発注を登録する(BASEには一切書き込まない、UniStock内部完結の操作)。
    expected_delivery_dateはYYYY-MM-DD形式。"""
    return await _write(
        "POST",
        "/purchase-orders",
        {
            "part_id": part_id,
            "shop_id": shop_id,
            "quantity": quantity,
            "note": note,
            "expected_delivery_date": expected_delivery_date,
            "order_url": order_url,
        },
    )


@mcp.tool()
async def receive_purchase_order(order_id: int, received_at: str | None = None) -> Any:
    """発注を入荷済みにする(対象部品の在庫が加算される)。received_at省略時は現在時刻。"""
    return await _write("POST", f"/purchase-orders/{order_id}/receive", {"received_at": received_at})


@mcp.tool()
async def undo_receive_purchase_order(order_id: int) -> Any:
    """発注の入荷登録を取り消す(在庫が入荷分だけ減算され、ステータスがordered状態に戻る)。"""
    return await _write("POST", f"/purchase-orders/{order_id}/undo-receive")


@mcp.tool()
async def cancel_purchase_order(order_id: int) -> Any:
    """発注をキャンセルする(未入荷の発注のみ対象)。"""
    return await _write("POST", f"/purchase-orders/{order_id}/cancel")


@mcp.tool()
async def update_dispatch_status(order_id: int, dispatch_status: str) -> Any:
    """注文の発送状態を更新する("dispatched"または"cancelled")。
    手動ショップ(BASE等の外部EC連携がないショップ)の注文にのみ許可される安全な操作で、
    BASE連携ショップの注文に対しては使えない(バックエンド側で拒否されエラーが返る)。"""
    return await _write("PATCH", f"/orders/{order_id}/dispatch-status", {"dispatch_status": dispatch_status})


@mcp.tool()
async def undo_dispatch(order_id: int) -> Any:
    """注文の発送確定を取り消す。update_dispatch_status同様、手動ショップの注文にのみ許可される。"""
    return await _write("POST", f"/orders/{order_id}/undo-dispatch")


@mcp.tool()
async def create_part(
    name: str,
    sku: str | None = None,
    stock: int = 0,
    unit_cost: int | None = None,
    tags: list[str] | None = None,
    group: str | None = None,
    colors: list[str] | None = None,
    purchase_url: str | None = None,
    reorder_threshold: int | None = None,
    purchasable: bool = True,
    memo: str | None = None,
) -> Any:
    """部品を新規登録する(BASEには一切書き込まない)。"""
    return await _write(
        "POST",
        "/parts",
        {
            "name": name,
            "sku": sku,
            "stock": stock,
            "unit_cost": unit_cost,
            "tags": tags,
            "group": group,
            "colors": colors,
            "purchase_url": purchase_url,
            "reorder_threshold": reorder_threshold,
            "purchasable": purchasable,
            "memo": memo,
        },
    )


@mcp.tool()
async def add_part_stock(part_id: int, quantity: int, note: str | None = None) -> Any:
    """部品の在庫を加算する(手動での在庫調整)。"""
    return await _write("POST", f"/parts/{part_id}/add-stock", {"quantity": quantity, "note": note})


@mcp.tool()
async def create_assembly(
    name: str,
    sku: str | None = None,
    stock: int = 0,
    unit_cost: int | None = None,
    tags: list[str] | None = None,
    group: str | None = None,
    memo: str | None = None,
    recipe: list[dict[str, Any]] | None = None,
) -> Any:
    """中間品を新規登録する(BASEには一切書き込まない)。
    recipeは任意で、レシピ(組成)も同時に登録する場合に
    [{"material_type": "part"|"assembly", "material_id": 部品/中間品ID, "quantity": 数量}, ...]
    の形式で渡す。"""
    return await _write(
        "POST",
        "/assemblies",
        {
            "name": name,
            "sku": sku,
            "stock": stock,
            "unit_cost": unit_cost,
            "tags": tags,
            "group": group,
            "memo": memo,
            "recipe": recipe or [],
        },
    )


@mcp.tool()
async def replace_assembly_recipe(assembly_id: int, lines: list[dict[str, Any]]) -> Any:
    """中間品のレシピ(組成)を丸ごと置き換える。linesは
    [{"material_type": "part"|"assembly", "material_id": 部品/中間品ID, "quantity": 数量}, ...]。"""
    return await _write("PUT", f"/assemblies/{assembly_id}/recipe", {"lines": lines})


@mcp.tool()
async def build_assembly(assembly_id: int, quantity: int, note: str | None = None) -> Any:
    """中間品を組み立てる(レシピ通りに材料在庫を消費し、中間品在庫を加算する)。
    材料在庫が不足している場合はエラーになる。"""
    return await _write("POST", f"/assemblies/{assembly_id}/build", {"quantity": quantity, "note": note})


@mcp.tool()
async def create_bom_item(
    shop_id: int,
    item_id: str,
    quantity: int,
    component_type: str = "part",
    part_id: int | None = None,
    assembly_id: int | None = None,
    item_name: str | None = None,
) -> Any:
    """指定ショップの商品に、BOM行(構成部品)を1つ追加する(BASEには一切書き込まない)。
    component_type="part"ならpart_idを、"assembly"ならassembly_idを指定する(片方のみ)。"""
    return await _write(
        "POST",
        f"/shops/{shop_id}/bom",
        {
            "item_id": item_id,
            "item_name": item_name,
            "quantity": quantity,
            "component_type": component_type,
            "part_id": part_id,
            "assembly_id": assembly_id,
        },
    )


@mcp.tool()
async def update_bom_item(shop_id: int, bom_item_id: int, quantity: int) -> Any:
    """BOM行の数量を更新する。"""
    return await _write("PATCH", f"/shops/{shop_id}/bom/{bom_item_id}", {"quantity": quantity})


_RESTOCK_CONFIRM_THRESHOLD_HOURS = 12


@mcp.tool()
async def create_restock_schedule(
    shop_id: int,
    item_id: str,
    target_stock: int,
    run_at: str,
    item_name: str | None = None,
    confirm: bool = False,
) -> Any:
    """リストック予約を作成する(指定した日時にBASE等の外部ECへ在庫数をプッシュし、
    設定によっては顧客への再入荷通知メール送信につながる、書き込み系ツールの中で
    唯一実際にBASEへ影響しうる操作)。run_at時刻は実行するバックグラウンドジョブが
    後で自動的に処理する(このツール自体はDB登録のみで即座にBASEへは書き込まない)。

    run_atが現在時刻から12時間以内の場合、実行が確定的・即時的で取り消しにくいため、
    まずconfirm=falseのまま呼び出してユーザーに内容を提示し、明示的な同意を得てから
    confirm=trueで再度呼び出すこと。12時間より先の予定なら確認なしで登録してよい。
    run_atはISO 8601形式(例: 2026-09-10T09:00:00+09:00)。"""
    try:
        run_at_dt = datetime.fromisoformat(run_at)
    except ValueError:
        return {"error": f"run_atの形式が不正です(ISO 8601形式で指定してください): {run_at}"}
    if run_at_dt.tzinfo is None:
        run_at_dt = run_at_dt.replace(tzinfo=timezone.utc)

    hours_until_run = (run_at_dt - datetime.now(timezone.utc)).total_seconds() / 3600
    if hours_until_run < _RESTOCK_CONFIRM_THRESHOLD_HOURS and not confirm:
        return {
            "requires_confirmation": True,
            "message": (
                f"実行予定時刻まで{max(hours_until_run, 0):.1f}時間しかありません。"
                f"実行されるとBASE等への実際の在庫反映・顧客への通知が発生する可能性があります。"
                "内容をユーザーに提示し、明示的な同意を得てからconfirm=trueで再度呼び出してください。"
            ),
        }

    return await _write(
        "POST",
        "/schedules",
        {"shop_id": shop_id, "item_id": item_id, "item_name": item_name, "target_stock": target_stock, "run_at": run_at},
    )


@mcp.tool()
async def cancel_restock_schedule(schedule_id: int) -> Any:
    """未実行のリストック予約をキャンセルする(実行前なら安全)。"""
    return await _write("DELETE", f"/schedules/{schedule_id}")


def _run_streamable_http() -> None:
    """常時起動のWebサービスとして動かす(Docker運用向け)。ネットワーク越しに
    誰でも叩けてしまわないよう、UNISTOCK_API_KEYと同じ値をこのMCPサーバー自体への
    接続にもBearerトークンとして要求する(MCPクライアント側は1つの値しか送らないため、
    別名の変数は用意せず単一のAPI_KEYで兼用する)。"""
    import uvicorn
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    class BearerAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Any) -> Any:
            auth_header = request.headers.get("authorization", "")
            if auth_header != f"Bearer {API_KEY}":
                return JSONResponse({"error": "認証エラー"}, status_code=401)
            return await call_next(request)

    app = mcp.streamable_http_app(host=HTTP_HOST)
    app.add_middleware(BearerAuthMiddleware)
    uvicorn.run(app, host=HTTP_HOST, port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    if TRANSPORT == "streamable-http":
        _run_streamable_http()
    else:
        mcp.run()
