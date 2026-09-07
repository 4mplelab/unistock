import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EVENT_LOGS_LAST_SEEN_KEY, fetchEventLogs } from "../api/client";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { EVENT_LOG_CATEGORY_LABEL as CATEGORY_LABEL, EVENT_LOG_LEVEL_CLASS as LEVEL_CLASS, EVENT_LOG_LEVEL_LABEL as LEVEL_LABEL } from "@/lib/eventLog";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatDateTime } from "@/lib/datetime";

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default function EventLogListPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightIdRaw = searchParams.get("highlight");
  const highlightId = highlightIdRaw ? Number(highlightIdRaw) : null;
  const [flashId, setFlashId] = useState<number | null>(null);
  const { shops, currentShopId } = useShopContext();
  // デフォルトは「表示中のショップ+共通」。"all"を選ぶと全ショップ混在で表示される
  const [shopFilter, setShopFilter] = useState<number | "all">(currentShopId ?? "all");
  const [includeShared, setIncludeShared] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["event-logs", page, pageSize, shopFilter, includeShared],
    queryFn: () =>
      fetchEventLogs(
        pageSize,
        (page - 1) * pageSize,
        highlightId ?? undefined,
        shopFilter === "all" ? undefined : shopFilter,
        shopFilter === "all" ? undefined : includeShared
      ),
    refetchInterval: 30000,
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  // リンク経由で特定のイベントログ(?highlight=id)が指定されている場合、サーバーが
  // そのイベントログを含むページを計算して返してくるので、そのページに合わせてから
  // 該当行を一時的にハイライトしてスクロールする
  useEffect(() => {
    if (!data || !highlightId) return;
    if (data.page !== page) {
      setPage(data.page);
      return;
    }
    setFlashId(highlightId);
    searchParams.delete("highlight");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!flashId) return;
    document.getElementById(`event-log-row-${flashId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(timer);
  }, [flashId]);

  useEffect(() => {
    if (!highlightId) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  // このページを開いたこと自体を既読として記録する(ログを消すのではなく、サイドバーの
  // 通知バッジを「最後に開いて以降に増えた件数」に切り替えるための基準時刻)
  useEffect(() => {
    localStorage.setItem(EVENT_LOGS_LAST_SEEN_KEY, new Date().toISOString());
    queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">イベントログ</h1>
        <p className="mt-1 text-sm text-muted-foreground-subtle">
          引当スキップ・在庫操作失敗・自動データ削除など、確認・対応が必要な業務イベントの記録です
        </p>
      </div>

      <Card className="mb-10">
        <CardContent className="flex flex-wrap items-end gap-6 pt-6">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-shop">ショップ</Label>
            <select
              id="filter-shop"
              className={selectClass}
              value={shopFilter}
              onChange={(e) => setShopFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">全て</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={includeShared} onCheckedChange={setIncludeShared} disabled={shopFilter === "all"} />
            共通データを含む
          </label>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && data && data.items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">イベントはまだありません。</p>
          )}

          {!isLoading && !error && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>レベル</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>内容</TableHead>
                  <TableHead>関連注文</TableHead>
                  <TableHead>対象商品</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((log) => (
                  <TableRow
                    key={log.id}
                    id={`event-log-row-${log.id}`}
                    className={cn("transition-colors duration-1000", log.id === flashId && "bg-amber-100 dark:bg-amber-500/20")}
                  >
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("border-transparent", LEVEL_CLASS[log.level])}>
                        {LEVEL_LABEL[log.level] ?? log.level}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{CATEGORY_LABEL[log.category] ?? log.category}</TableCell>
                    <TableCell className="whitespace-normal">{log.message}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {log.order_unique_key ? (
                        log.shop_id === currentShopId ? (
                          <Link
                            to={`/orders?highlight=${encodeURIComponent(log.order_unique_key)}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {log.order_unique_key}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground-subtle">
                            {log.order_unique_key}
                            <span className="ml-1">
                              ({shops.find((s) => s.id === log.shop_id)?.name ?? "他ショップ"})
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground-subtle">-</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {log.item_id ? (
                        log.shop_id === currentShopId ? (
                          <Link
                            to={`/bom/${currentShopId}/${encodeURIComponent(log.item_id)}/edit`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {log.item_id}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground-subtle">
                            {log.item_id}
                            <span className="ml-1">
                              ({shops.find((s) => s.id === log.shop_id)?.name ?? "他ショップ"})
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground-subtle">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  );
}
