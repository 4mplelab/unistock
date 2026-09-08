"""UniStockの既存REST APIを読み取り専用ツールとしてMCP公開するサーバー。

DBには一切触れず、UniStockの稼働中インスタンスに対してAPIキー(Bearer)付きで
HTTPリクエストするだけの薄いラッパー。書き込み系(発注・削除等)は含めない。

環境変数:
  UNISTOCK_API_BASE_URL  例: http://localhost:8000/api (既定値)
  UNISTOCK_API_KEY       設定画面「APIキー」から発行した値(必須。UniStock APIの呼び出しと、
                          MCP_TRANSPORT=streamable-http時のこのMCPサーバー自体への
                          接続認証の両方に使う)
  MCP_TRANSPORT          stdio(既定、AIアプリがローカルでプロセス起動する方式)
                          または streamable-http(常時起動のWebサービスとして動かし、
                          ネットワーク越しに接続する方式。Docker運用向け)
  MCP_HTTP_HOST          streamable-http時の待受ホスト(既定 0.0.0.0)
  MCP_HTTP_PORT          streamable-http時の待受ポート(既定 8765)
"""

import os
from typing import Any

import httpx
from mcp.server.mcpserver import MCPServer

API_BASE_URL = os.environ.get("UNISTOCK_API_BASE_URL", "http://localhost:8000/api")
API_KEY = os.environ.get("UNISTOCK_API_KEY")
TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")
HTTP_HOST = os.environ.get("MCP_HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.environ.get("MCP_HTTP_PORT", "8765"))

if not API_KEY:
    raise RuntimeError("環境変数 UNISTOCK_API_KEY が設定されていません")

mcp = MCPServer("UniStock")


async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=10.0) as client:
        response = await client.get(
            path,
            params={k: v for k, v in (params or {}).items() if v is not None},
            headers={"Authorization": f"Bearer {API_KEY}"},
        )
        response.raise_for_status()
        return response.json()


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


def _run_streamable_http() -> None:
    """常時起動のWebサービスとして動かす(Docker運用向け)。ネットワーク越しに
    誰でも叩けてしまわないよう、UNISTOCK_API_KEYと同じ値をこのMCPサーバー自体への
    接続にもBearerトークンとして要求する(UniStock API呼び出し用の鍵を再利用し、
    別の秘密情報を増やさない設計)。"""
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
