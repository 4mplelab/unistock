import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAssemblies, fetchParts, fetchStockMovements } from "../api/client";
import type {
  StockMovementComponentType,
  StockMovementFilters,
  StockMovementReason,
} from "../types/stock_movement";
import { REASON_LABEL } from "../components/StockMovementHistoryCard";
import ComponentCombobox, { type ComponentOption } from "@/components/ComponentCombobox";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatDateTime } from "@/lib/datetime";
import { formatSignedNumber } from "@/lib/format";

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default function StockMovementListPage() {
  const [searchParams] = useSearchParams();
  const { shops, currentShopId } = useShopContext();

  const [componentType, setComponentType] = useState<StockMovementComponentType | "">("");
  const [componentId, setComponentId] = useState<number | "">("");
  const [reason, setReason] = useState<StockMovementReason | "">("");
  const [orderUniqueKey, setOrderUniqueKey] = useState(searchParams.get("order") ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // デフォルトは「表示中のショップ+共通」。"all"を選ぶと全ショップ混在で表示される
  const [shopFilter, setShopFilter] = useState<number | "all">(currentShopId ?? "all");
  const [includeShared, setIncludeShared] = useState(true);

  const [appliedFilters, setAppliedFilters] = useState<StockMovementFilters>(() => {
    const initialOrder = searchParams.get("order");
    if (initialOrder) return { order_unique_key: initialOrder };
    return currentShopId != null ? { shop_id: currentShopId, include_shared: true } : {};
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();

  const partsQuery = useQuery({ queryKey: ["parts"], queryFn: fetchParts });
  const assembliesQuery = useQuery({ queryKey: ["assemblies"], queryFn: fetchAssemblies });

  const targets: ComponentOption[] =
    componentType === "assembly"
      ? (assembliesQuery.data ?? []).map((a) => ({ ...a, type: "assembly" as const }))
      : componentType === "part"
        ? (partsQuery.data ?? [])
        : [];

  const { data, isLoading, error } = useQuery({
    queryKey: ["stock-movements", "list", appliedFilters, page, pageSize],
    queryFn: () => fetchStockMovements(appliedFilters, pageSize, (page - 1) * pageSize),
  });

  function applyFilters() {
    const filters: StockMovementFilters = {};
    if (componentType) filters.component_type = componentType;
    if (componentType && componentId !== "") {
      if (componentType === "part") filters.part_id = componentId;
      else filters.assembly_id = componentId;
    }
    if (reason) filters.reason = reason;
    if (orderUniqueKey) filters.order_unique_key = orderUniqueKey;
    if (dateFrom) filters.date_from = new Date(dateFrom).toISOString();
    if (dateTo) filters.date_to = new Date(dateTo).toISOString();
    if (shopFilter !== "all") {
      filters.shop_id = shopFilter;
      filters.include_shared = includeShared;
    }
    setAppliedFilters(filters);
    setPage(1);
  }

  // 注文一覧からのリンク遷移(?order=)時は自動的に検索を実行する
  useEffect(() => {
    const order = searchParams.get("order");
    if (order) applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    applyFilters();
  }

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">在庫変動履歴</h1>
        <p className="mt-1 text-sm text-muted-foreground-subtle">
          部品・中間品の在庫が変わったすべての操作を横断して確認します
        </p>
      </div>

      <Card className="mb-10">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-6">
            <div className="grid gap-1.5">
              <Label htmlFor="filter-component-type">対象種別</Label>
              <select
                id="filter-component-type"
                className={selectClass}
                value={componentType}
                onChange={(e) => {
                  setComponentType(e.target.value as StockMovementComponentType | "");
                  setComponentId("");
                }}
              >
                <option value="">全て</option>
                <option value="part">部品</option>
                <option value="assembly">中間品</option>
              </select>
            </div>
            <div className="grid w-56 gap-1.5">
              <Label htmlFor="filter-component-id">対象</Label>
              <ComponentCombobox
                id="filter-component-id"
                items={targets}
                value={componentId}
                onChange={setComponentId}
                disabled={!componentType}
                emptyLabel="全て"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-reason">変動理由</Label>
              <select
                id="filter-reason"
                className={selectClass}
                value={reason}
                onChange={(e) => setReason(e.target.value as StockMovementReason | "")}
              >
                <option value="">全て</option>
                {Object.entries(REASON_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-order">関連注文ID</Label>
              <Input
                id="filter-order"
                value={orderUniqueKey}
                onChange={(e) => setOrderUniqueKey(e.target.value)}
                placeholder="部分一致"
                className="w-40"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-date-from">期間(開始)</Label>
              <Input
                id="filter-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-date-to">期間(終了)</Label>
              <Input id="filter-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
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
              <Switch
                checked={includeShared}
                onCheckedChange={setIncludeShared}
                disabled={shopFilter === "all"}
              />
              共通データを含む
            </label>
            <Button type="submit">検索する</Button>
          </form>
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
            <p className="py-12 text-center text-sm text-muted-foreground">該当する在庫変動履歴はありません。</p>
          )}
          {!isLoading && !error && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>対象種別</TableHead>
                  <TableHead>対象</TableHead>
                  <TableHead>変動理由</TableHead>
                  <TableHead>数量</TableHead>
                  <TableHead>メモ</TableHead>
                  <TableHead>関連</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {m.component_type === "part" ? "部品" : "中間品"}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={
                          m.component_type === "part"
                            ? `/parts/${m.component_id}/edit`
                            : `/assemblies/${m.component_id}/edit`
                        }
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {m.component_name}
                      </Link>
                    </TableCell>
                    <TableCell>{REASON_LABEL[m.reason] ?? m.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSignedNumber(m.quantity)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.note ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {m.order_unique_key ? (
                        m.shop_id === currentShopId ? (
                          <Link
                            to={`/orders?highlight=${encodeURIComponent(m.order_unique_key)}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {m.order_unique_key}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground-subtle">
                            {m.order_unique_key}
                            <span className="ml-1">
                              ({shops.find((s) => s.id === m.shop_id)?.name ?? "他ショップ"})
                            </span>
                          </span>
                        )
                      ) : m.purchase_order_id ? (
                        m.shop_id === currentShopId ? (
                          <Link
                            to={`/purchase-orders?highlight=${m.purchase_order_id}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            発注#{m.purchase_order_id}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground-subtle">
                            発注#{m.purchase_order_id}
                            <span className="ml-1">
                              ({shops.find((s) => s.id === m.shop_id)?.name ?? "他ショップ"})
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
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
