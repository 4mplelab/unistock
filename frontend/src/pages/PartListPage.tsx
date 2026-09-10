import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPartStock,
  createPurchaseOrder,
  deletePart,
  exportPartsCsv,
  fetchParts,
  fetchPartReservations,
  importPartsCsv,
} from "../api/client";
import ReservingOrdersDialog from "../components/ReservingOrdersDialog";
import { useReservationLookup } from "../hooks/useReservationLookup";
import { useShopContext } from "@/contexts/ShopContext";
import type { Part } from "../types/part";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check, ExternalLink, MoreVertical, PackagePlus, ShoppingCart } from "lucide-react";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import TagBadge from "../components/TagBadge";
import GroupChip from "../components/GroupChip";
import PartColorSwatches from "../components/PartColorSwatches";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { preventEnterSubmit } from "@/lib/forms";
import { readStoredToggle, writeStoredToggle } from "@/lib/storage";
import Hint from "@/components/Hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function matchesSearch(part: Part, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    part.name.toLowerCase().includes(q) ||
    (part.sku ?? "").toLowerCase().includes(q) ||
    (part.tags ?? []).some((t) => t.toLowerCase().includes(q))
  );
}

const selectClass =
  "h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const GROUP_SORT_KEY = "unistock.parts.group_sort";

// グループでまとめる表示がオンのとき用の並び順。グループ→名前の順にし、
// グループ未設定(空文字列扱い)の部品は末尾にまとめる
function compareByGroupThenName(a: Part, b: Part): number {
  const groupA = a.group ?? "";
  const groupB = b.group ?? "";
  if (groupA !== groupB) {
    if (groupA === "") return 1;
    if (groupB === "") return -1;
    return groupA.localeCompare(groupB, "ja");
  }
  return a.name.localeCompare(b.name, "ja");
}

export default function PartListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { currentShopId } = useShopContext();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [groupSort, setGroupSort] = useState(() => readStoredToggle(GROUP_SORT_KEY, false));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [partToDelete, setPartToDelete] = useState<Part | null>(null);
  const [partToOrder, setPartToOrder] = useState<Part | null>(null);
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [orderExpectedDeliveryDate, setOrderExpectedDeliveryDate] = useState("");
  const [orderUrl, setOrderUrl] = useState("");
  const [partToStock, setPartToStock] = useState<Part | null>(null);
  const [stockQuantity, setStockQuantity] = useState(1);
  const [stockNote, setStockNote] = useState("");
  const [reservationsTarget, setReservationsTarget] = useState<{ id: number; name: string } | null>(null);
  const lookupReservation = useReservationLookup(fetchPartReservations);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const orderFeedback = useSaveFeedback();
  const stockFeedback = useSaveFeedback();

  const { data, isLoading, error } = useQuery({
    queryKey: ["parts"],
    queryFn: fetchParts,
  });

  const deleteMutation = useMutation({
    mutationFn: deletePart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      setPartToDelete(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: importPartsCsv,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["parts"] }),
  });

  const orderMutation = useMutation({
    mutationFn: () => {
      if (!partToOrder) throw new Error("部品が選択されていません");
      if (currentShopId == null) throw new Error("ショップが選択されていません");
      return createPurchaseOrder({
        part_id: partToOrder.id,
        shop_id: currentShopId,
        quantity: orderQuantity,
        expected_delivery_date: orderExpectedDeliveryDate || null,
        order_url: orderUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["reorder-needed"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
      orderFeedback.succeed("order");
      setTimeout(() => setPartToOrder(null), 500);
    },
  });

  function openOrderDialog(p: Part) {
    setOrderQuantity(p.reorder_threshold ? Math.max(1, p.reorder_threshold - p.available) : 1);
    setOrderExpectedDeliveryDate("");
    setOrderUrl("");
    orderMutation.reset();
    setPartToOrder(p);
  }

  function handleOrderSubmit(e: FormEvent) {
    e.preventDefault();
    orderMutation.mutate();
  }

  const addStockMutation = useMutation({
    mutationFn: () => {
      if (!partToStock) throw new Error("部品が選択されていません");
      return addPartStock(partToStock.id, stockQuantity, stockNote || null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      stockFeedback.succeed("stock");
      setTimeout(() => setPartToStock(null), 500);
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportPartsCsv,
  });

  function openStockDialog(p: Part) {
    setStockQuantity(1);
    setStockNote("");
    addStockMutation.reset();
    setPartToStock(p);
  }

  function handleStockSubmit(e: FormEvent) {
    e.preventDefault();
    addStockMutation.mutate();
  }

  const groups = useMemo(
    () => [...new Set((data ?? []).map((p) => p.group).filter((g): g is string => !!g))].sort(),
    [data]
  );

  const filtered = (data ?? []).filter(
    (p) => matchesSearch(p, search) && (!groupFilter || p.group === groupFilter)
  );
  const sorted = groupSort ? [...filtered].sort(compareByGroupThenName) : filtered;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, groupFilter, pageSize]);

  function handleGroupSortChange(checked: boolean) {
    setGroupSort(checked);
    writeStoredToggle(GROUP_SORT_KEY, checked);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = "";
  }

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">部品</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">部品の在庫・引当状況を管理します</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button variant="outline" onClick={handleImportClick} disabled={importMutation.isPending}>
            {importMutation.isPending ? "インポート中..." : "インポート"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? "エクスポート中..." : "エクスポート"}
          </Button>
          <Link to="/parts/new" className={buttonVariants({ variant: "default" })}>
            新規作成
          </Link>
        </div>
      </div>
      <FieldError message={exportMutation.error ? (exportMutation.error as Error).message : null} />

      {importMutation.data && (
        <div className="mb-4 rounded-lg bg-muted px-4 py-3 text-sm">
          インポート結果: 新規{importMutation.data.created}件・更新{importMutation.data.updated}件
          {importMutation.data.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-destructive">
              {importMutation.data.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {importMutation.error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(importMutation.error as Error).message}
        </p>
      )}

      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="part-search">検索</Label>
          <Input
            id="part-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="名前・SKU・タグで検索"
            className="w-64"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="part-group-filter">グループ</Label>
          <select
            id="part-group-filter"
            className={selectClass}
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">全て</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Switch checked={groupSort} onCheckedChange={handleGroupSortChange} />
          グループでまとめる
        </label>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && (!data || data.length === 0) && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              部品はまだありません。右上の「新規作成」から登録してください。
            </p>
          )}
          {!isLoading && !error && data && data.length > 0 && filtered.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">検索条件に一致する部品がありません。</p>
          )}

          {!isLoading && !error && filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>SKU</TableHead>
                  {!groupSort && <TableHead>グループ</TableHead>}
                  <TableHead className="w-28 text-center">利用可能</TableHead>
                  <TableHead className="w-28 text-center">発注点</TableHead>
                  <TableHead className="w-28 text-center">単価</TableHead>
                  <TableHead className="sticky right-0 bg-muted px-2 last:pr-2"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((p, i) => {
                  const showGroupHeader = groupSort && (i === 0 || p.group !== paged[i - 1].group);
                  return (
                  <Fragment key={p.id}>
                    {showGroupHeader && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={groupSort ? 6 : 7}
                          className="bg-muted py-2.5 text-sm font-semibold text-foreground"
                        >
                          {p.group || "グループ未設定"}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className="cursor-pointer" onClick={() => navigate(`/parts/${p.id}/edit`)}>
                    <TableCell>
                      <div className={cn("flex flex-col gap-1", groupSort && "pl-4")}>
                        <div className="flex items-center gap-1.5">
                          {p.purchase_url ? (
                            <Hint label="購入先を開く">
                              <a
                                href={p.purchase_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                              >
                                {p.name}
                                <ExternalLink className="size-3 shrink-0 text-muted-foreground-subtle" />
                              </a>
                            </Hint>
                          ) : (
                            p.name
                          )}
                          <PartColorSwatches colors={p.colors} />
                        </div>
                        {(p.tags ?? []).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            {(p.tags ?? []).map((t) => (
                              <TagBadge key={t} tag={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.sku ?? <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    {!groupSort && (
                      <TableCell>
                        {p.group ? <GroupChip group={p.group} /> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex h-full items-center justify-end gap-2">
                        <Hint label={p.reserved > 0 ? `在庫${formatNumber(p.stock)} - 引当${formatNumber(p.reserved)}` : null}>
                          <span
                            className={cn(
                              "min-w-8 shrink-0 text-right tabular-nums font-medium",
                              p.available < 0 && "text-destructive"
                            )}
                          >
                            {formatNumber(p.available)}
                          </span>
                        </Hint>
                        {(p.reserved > 0 || p.ordered_quantity > 0) && (
                          <div className="flex flex-col items-start gap-0.5 self-start">
                            {p.reserved > 0 && (
                              <Badge
                                className="h-4 cursor-pointer border-transparent bg-blue-100 px-1.5 text-[10px] leading-none text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  lookupReservation({ id: p.id, name: p.name }, setReservationsTarget);
                                }}
                              >
                                引当{formatNumber(p.reserved)}
                              </Badge>
                            )}
                            {p.ordered_quantity > 0 && (
                              <Badge className="h-4 border-transparent bg-amber-100 px-1.5 text-[10px] leading-none text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                                発注中{formatNumber(p.ordered_quantity)}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.reorder_threshold != null ? formatNumber(p.reorder_threshold) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.unit_cost != null ? (
                        `¥${formatNumber(p.unit_cost)}`
                      ) : (
                        <Hint label="単価未設定(粗利計算では0円扱いになります)">
                          <span className="text-muted-foreground">-</span>
                        </Hint>
                      )}
                    </TableCell>
                    <TableCell
                      className="sticky right-0 whitespace-nowrap bg-card px-2 last:pr-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {p.purchasable && (
                          <Hint label="発注する">
                            <Button variant="outline" size="icon-sm" onClick={() => openOrderDialog(p)}>
                              <ShoppingCart />
                            </Button>
                          </Hint>
                        )}
                        <Hint label="在庫追加">
                          <Button variant="outline" size="icon-sm" onClick={() => openStockDialog(p)}>
                            <PackagePlus />
                          </Button>
                        </Hint>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                            aria-label="その他の操作"
                          >
                            <MoreVertical />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => navigate(`/parts/new?duplicate=${p.id}`)}>
                              複製して新規作成
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setPartToDelete(p)}>
                              削除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>

      <Dialog open={!!partToDelete} onOpenChange={(open) => !open && setPartToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>部品を削除しますか？</DialogTitle>
            <DialogDescription>
              「{partToDelete?.name}」を削除します。この操作は取り消せません。BOMで使用中の部品は削除できません。
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(deleteMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartToDelete(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => partToDelete && deleteMutation.mutate(partToDelete.id)}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!partToOrder} onOpenChange={(open) => !open && setPartToOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>発注する</DialogTitle>
            <DialogDescription>「{partToOrder?.name}」の発注数量を入力してください。</DialogDescription>
          </DialogHeader>
          <form id="part-order-form" onSubmit={handleOrderSubmit} onKeyDown={preventEnterSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="part_order_quantity">数量</Label>
              <NumberInput
                id="part_order_quantity"
                value={String(orderQuantity)}
                onChange={(v) => setOrderQuantity(Number(v))}
                className="w-32 text-right"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="part_order_expected_delivery_date">納品予定日</Label>
              <Input
                id="part_order_expected_delivery_date"
                type="date"
                value={orderExpectedDeliveryDate}
                onChange={(e) => setOrderExpectedDeliveryDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="part_order_url">発注URL</Label>
              <Input
                id="part_order_url"
                value={orderUrl}
                onChange={(e) => setOrderUrl(e.target.value)}
                placeholder="発注先のURLを貼り付け(後からでも入力可)"
              />
            </div>
          </form>
          {orderMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(orderMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartToOrder(null)}>
              キャンセル
            </Button>
            <Button
              type="submit"
              form="part-order-form"
              disabled={orderMutation.isPending || orderQuantity <= 0 || currentShopId == null}
            >
              {orderFeedback.isFlashing("order") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  発注しました
                </span>
              ) : orderMutation.isPending ? (
                "発注中..."
              ) : (
                "発注する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!partToStock} onOpenChange={(open) => !open && setPartToStock(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>在庫を追加する</DialogTitle>
            <DialogDescription>
              「{partToStock?.name}」の在庫に加算する数量を入力してください（発注は行われません）。
            </DialogDescription>
          </DialogHeader>
          <form id="part-stock-form" onSubmit={handleStockSubmit} onKeyDown={preventEnterSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="part_stock_quantity">追加数量</Label>
              <NumberInput
                id="part_stock_quantity"
                value={String(stockQuantity)}
                onChange={(v) => setStockQuantity(Number(v))}
                className="w-32 text-right"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="part_stock_note">メモ</Label>
              <Input
                id="part_stock_note"
                value={stockNote}
                onChange={(e) => setStockNote(e.target.value)}
                placeholder="在庫変動履歴に記録されます"
              />
            </div>
          </form>
          {addStockMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(addStockMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartToStock(null)}>
              キャンセル
            </Button>
            <Button
              type="submit"
              form="part-stock-form"
              disabled={addStockMutation.isPending || stockQuantity <= 0}
            >
              {stockFeedback.isFlashing("stock") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  追加しました
                </span>
              ) : addStockMutation.isPending ? (
                "追加中..."
              ) : (
                "追加する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReservingOrdersDialog
        target={reservationsTarget}
        onClose={() => setReservationsTarget(null)}
        fetchReservations={fetchPartReservations}
      />
    </div>
  );
}
