import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, ListChecks, MoreVertical, Truck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOrders, syncOrdersNow, undoOrderDispatch, updateOrderDispatchStatus } from "../api/client";
import ManualOrderCsvImportDialog from "@/components/ManualOrderCsvImportDialog";
import type { Order } from "../types/order";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatNumber } from "@/lib/format";
import OrderStatusBadge from "../components/OrderStatusBadge";
import BaseOrderLinkButton from "../components/BaseOrderLinkButton";
import { OrderPdfExportContent, OrderPdfExportToolbar, useOrderPdfExport } from "../components/OrderPdfExportPanel";
import Hint from "@/components/Hint";
import { formatDateTime } from "@/lib/datetime";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import { readStoredToggle, writeStoredToggle } from "@/lib/storage";

const SHOW_CANCELLED_ORDERS_KEY = "unistock.orders.show_cancelled_orders";
const SHOW_CANCELLED_ITEMS_KEY = "unistock.orders.show_cancelled_items";
// 発送直後だけ、その場のボタンを一時的に「取り消す」に変える猶予時間。この時間を過ぎても
// 発送取消し自体は右端の⋮メニューから引き続きできる(そちらは時間制限なし、常設の手段)
const DISPATCH_UNDO_WINDOW_MS = 6000;

// 状態列: バッジ、ピッキング、発送(手動ショップのみ)を縦に並べて表示する。編集・キャンセルは
// 性質が異なる(状態そのものではなく管理操作)ため、他の一覧画面と揃えて右端の操作列
// (OrderRowActions)に置く。発送した直後だけ、誤操作にすぐ気づけるようボタン自体が
// 一時的に「取り消す」に変わる(時間切れ後も⋮メニューのundoは残るので、機能を失うわけではない)
function OrderStatusCell({ order, fullyPicked }: { order: Order; fullyPicked: boolean }) {
  const queryClient = useQueryClient();
  const [justDispatched, setJustDispatched] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const dispatchMutation = useMutation({
    mutationFn: () => updateOrderDispatchStatus(order.id, "dispatched"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
      setJustDispatched(true);
      undoTimerRef.current = setTimeout(() => setJustDispatched(false), DISPATCH_UNDO_WINDOW_MS);
    },
  });
  const undoMutation = useMutation({
    mutationFn: () => undoOrderDispatch(order.id),
    onSuccess: () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setJustDispatched(false);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const isManualOrdered = order.platform === "manual" && order.dispatch_status === "ordered";
  const showInlineUndo = justDispatched && order.platform === "manual" && order.dispatch_status === "dispatched";

  return (
    <>
      <div className="flex flex-nowrap items-center gap-x-2 gap-y-0.5">
        <OrderStatusBadge status={order.dispatch_status} />
        {isManualOrdered && (
          <Hint label="発送済みにします。予約済みの部品・中間品が実際に消費されます">
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="発送"
                disabled={dispatchMutation.isPending}
                onClick={() => dispatchMutation.mutate()}
              >
                <Truck />
              </Button>
            </span>
          </Hint>
        )}
        {showInlineUndo && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            disabled={undoMutation.isPending}
            onClick={() => undoMutation.mutate()}
          >
            取り消す
          </button>
        )}
      </div>

      {order.dispatch_status === "ordered" && (
        <Link
          to={`/picking?highlight=${encodeURIComponent(order.unique_key)}`}
          className={cn(
            "mt-1.5 flex items-center gap-1 text-xs underline-offset-2 hover:underline",
            fullyPicked ? "text-green-600 dark:text-green-400" : "text-primary"
          )}
        >
          <ListChecks className="size-3" />
          {fullyPicked ? "ピッキング完了" : "ピッキング"}
        </Link>
      )}

      {dispatchMutation.error && (
        <p className="mt-1 text-xs text-destructive">{(dispatchMutation.error as Error).message}</p>
      )}
      {undoMutation.error && <p className="mt-1 text-xs text-destructive">{(undoMutation.error as Error).message}</p>}
    </>
  );
}

// 右端の操作列: 手動ショップの注文だけ、編集・キャンセル(未対応)/発送取消し(発送済み)を
// ⋮メニューにまとめる(他の一覧画面(発注管理等)の「右端の⋮メニュー」パターンに揃える)
function OrderRowActions({ order }: { order: Order }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const feedback = useSaveFeedback();
  const mutation = useMutation({
    mutationFn: () => updateOrderDispatchStatus(order.id, "cancelled"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
      setCancelOpen(false);
    },
  });
  const undoDispatchMutation = useMutation({
    mutationFn: () => undoOrderDispatch(order.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  if (order.platform !== "manual") {
    return null;
  }

  // 発送済み: 誤操作の救済用に発送取消し(部品の消費を取り消し、未対応へ戻す)だけを出す
  if (order.dispatch_status === "dispatched") {
    return (
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label="その他の操作"
          >
            <MoreVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              variant="destructive"
              disabled={undoDispatchMutation.isPending}
              onClick={() => undoDispatchMutation.mutate(undefined, feedback.callbacks("undo-dispatch"))}
            >
              発送取消し
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {feedback.errorFor("undo-dispatch") && (
          <Hint label={feedback.errorFor("undo-dispatch")}>
            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
          </Hint>
        )}
      </div>
    );
  }

  if (order.dispatch_status !== "ordered") {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label="その他の操作"
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => navigate(`/orders/${order.id}/edit`)}>編集</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setCancelOpen(true)}>
            キャンセル
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>注文をキャンセルしますか？</DialogTitle>
            <DialogDescription>
              「{order.unique_key}」をキャンセルします。予約済みの部品・中間品は解放されます。
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              戻る
            </Button>
            <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              キャンセルする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 複数選択して一括発送するための選択状態・実行処理。印刷用選択(useOrderPdfExport)と
// 同様、未対応の注文はデフォルトでチェックを入れる(seedDefaults)。印刷用選択とは
// 目的が異なるため独立した選択状態として持つ
function useBulkDispatch() {
  const queryClient = useQueryClient();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [seenIds, setSeenIds] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: string[]; dispatchedIds: number[] } | null>(null);
  const [showResultUndo, setShowResultUndo] = useState(false);
  const [isUndoingAll, setIsUndoingAll] = useState(false);
  const resultUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // まだ見ていない注文だけ、未対応ならデフォルトでチェックを入れる(useOrderPdfExportの
  // seedDefaultsと同じ考え方)。ユーザーが手動でチェック/解除した状態は上書きしない
  function seedDefaults(orders: { id: number; platform: string; dispatch_status: string }[]) {
    const newlySeen = orders.filter((o) => !seenIds.has(o.id));
    if (newlySeen.length === 0) return;
    setSeenIds((prev) => {
      const next = new Set(prev);
      newlySeen.forEach((o) => next.add(o.id));
      return next;
    });
    const toCheck = newlySeen
      .filter((o) => o.platform === "manual" && o.dispatch_status === "ordered")
      .map((o) => o.id);
    if (toCheck.length > 0) {
      setSelectedIds((prev) => new Set([...prev, ...toCheck]));
    }
  }

  function toggleId(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function reset() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setConfirmOpen(false);
    setResult(null);
    setShowResultUndo(false);
    if (resultUndoTimerRef.current) clearTimeout(resultUndoTimerRef.current);
  }

  async function handleDispatch() {
    const ids = [...selectedIds];
    setIsDispatching(true);
    const outcomes = await Promise.allSettled(ids.map((id) => updateOrderDispatchStatus(id, "dispatched")));
    const dispatchedIds = ids.filter((_, i) => outcomes[i].status === "fulfilled");
    const errors = outcomes
      .map((o, i) => (o.status === "rejected" ? `注文ID ${ids[i]}: ${(o.reason as Error).message}` : null))
      .filter((e): e is string => e !== null);
    setIsDispatching(false);
    setResult({ success: dispatchedIds.length, errors, dispatchedIds });
    setConfirmOpen(false);
    setSelectionMode(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["nav-counts"] });

    if (dispatchedIds.length > 0) {
      setShowResultUndo(true);
      resultUndoTimerRef.current = setTimeout(() => setShowResultUndo(false), DISPATCH_UNDO_WINDOW_MS);
    }
  }

  async function undoAll() {
    if (!result) return;
    if (resultUndoTimerRef.current) clearTimeout(resultUndoTimerRef.current);
    setIsUndoingAll(true);
    await Promise.allSettled(result.dispatchedIds.map((id) => undoOrderDispatch(id)));
    setIsUndoingAll(false);
    setShowResultUndo(false);
    setResult(null);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
  }

  return {
    selectionMode,
    setSelectionMode,
    selectedIds,
    seedDefaults,
    toggleId,
    reset,
    confirmOpen,
    setConfirmOpen,
    isDispatching,
    handleDispatch,
    result,
    showResultUndo,
    isUndoingAll,
    undoAll,
  };
}

export default function OrderListPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightKey = searchParams.get("highlight");
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const pdfExport = useOrderPdfExport();
  const bulkDispatch = useBulkDispatch();
  const { currentShopId, currentShop } = useShopContext();
  const syncFeedback = useSaveFeedback();
  // 注文・注文商品それぞれのキャンセル表示は独立して切り替えられる(デフォルトは両方とも表示)。
  // ページ遷移しても選択状態を保持するためlocalStorageに保存する
  const [showCancelledOrders, setShowCancelledOrdersState] = useState(() =>
    readStoredToggle(SHOW_CANCELLED_ORDERS_KEY, true)
  );
  const [showCancelledItems, setShowCancelledItemsState] = useState(() =>
    readStoredToggle(SHOW_CANCELLED_ITEMS_KEY, true)
  );

  function handleShowCancelledItemsChange(checked: boolean) {
    setShowCancelledItemsState(checked);
    writeStoredToggle(SHOW_CANCELLED_ITEMS_KEY, checked);
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["orders", page, pageSize, currentShopId, showCancelledOrders],
    queryFn: () =>
      fetchOrders(
        pageSize,
        (page - 1) * pageSize,
        highlightKey ?? undefined,
        currentShopId ?? undefined,
        showCancelledOrders
      ),
    refetchInterval: 10000,
  });

  function handleShowCancelledOrdersChange(checked: boolean) {
    setShowCancelledOrdersState(checked);
    writeStoredToggle(SHOW_CANCELLED_ORDERS_KEY, checked);
    setPage(1);
    // 表示対象の注文集合が変わるため、印刷用・一括発送用の選択状態は持ち越さずリセットする
    pdfExport.resetSelection();
    bulkDispatch.reset();
  }

  const syncMutation = useMutation({
    mutationFn: syncOrdersNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const [csvImportOpen, setCsvImportOpen] = useState(false);
  function handleOrdersImported() {
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
  }

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  // リンク経由で特定の注文(?highlight=unique_key)が指定されている場合、サーバーが
  // その注文を含むページを計算して返してくるので、そのページに合わせてから
  // 該当行を一時的にハイライトしてスクロールする
  useEffect(() => {
    if (!data || !highlightKey) return;
    if (data.page !== page) {
      setPage(data.page);
      return;
    }
    setFlashKey(highlightKey);
    searchParams.delete("highlight");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!flashKey) return;
    document
      .getElementById(`order-row-${flashKey}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlashKey(null), 2500);
    return () => clearTimeout(timer);
  }, [flashKey]);

  useEffect(() => {
    if (!highlightKey) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  // ページが読み込まれるたびに、まだ見ていない注文の選択状態(未対応ならデフォルトで
  // チェック)をPDF出力・一括発送の両方のフックに反映する
  useEffect(() => {
    if (!data) return;
    pdfExport.seedDefaults(data.items);
    bulkDispatch.seedDefaults(data.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">注文</h1>
            {currentShop?.platform === "manual" ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setCsvImportOpen(true)}>
                  CSVインポート
                </Button>
                <Link to="/orders/new" className={buttonVariants({ variant: "default", size: "sm" })}>
                  手動で注文を追加
                </Link>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncMutation.mutate(undefined, syncFeedback.callbacks("sync"))}
                  disabled={syncMutation.isPending}
                >
                  {syncFeedback.isFlashing("sync") ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="size-4" />
                      同期しました
                    </span>
                  ) : syncMutation.isPending ? (
                    "同期中..."
                  ) : (
                    "今すぐ同期"
                  )}
                </Button>
                {syncMutation.data && (
                  <span className="text-sm text-muted-foreground">
                    新規{syncMutation.data.new_orders}件・遷移{syncMutation.data.transitioned_orders}件
                    {syncMutation.data.errors.length > 0 && (
                      <span className="text-destructive">（エラー{syncMutation.data.errors.length}件）</span>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground-subtle">連携ショップから検知した注文の一覧</p>
          <FieldError message={syncFeedback.errorFor("sync")} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            {!bulkDispatch.selectionMode && <OrderPdfExportToolbar {...pdfExport} totalCount={data?.total ?? 0} />}
            {currentShop?.platform === "manual" && !pdfExport.selectionMode && (
              <>
                {!bulkDispatch.selectionMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkDispatch.setSelectionMode(true)}
                    disabled={!data?.items.some((o) => o.dispatch_status === "ordered")}
                  >
                    <Truck />
                    選択して発送
                  </Button>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">{bulkDispatch.selectedIds.size}件選択中</span>
                    <Button variant="outline" size="sm" onClick={bulkDispatch.reset}>
                      キャンセル
                    </Button>
                    <Button
                      size="sm"
                      disabled={bulkDispatch.selectedIds.size === 0}
                      onClick={() => bulkDispatch.setConfirmOpen(true)}
                    >
                      発送する
                    </Button>
                  </>
                )}
              </>
            )}
          </div>

          {bulkDispatch.result && (
            <p className="text-right text-sm text-muted-foreground print:hidden">
              一括発送: 成功{bulkDispatch.result.success}件
              {bulkDispatch.result.errors.length > 0 && (
                <span className="text-destructive">（エラー{bulkDispatch.result.errors.length}件）</span>
              )}
              {bulkDispatch.showResultUndo && (
                <button
                  type="button"
                  className="ml-2 text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={bulkDispatch.isUndoingAll}
                  onClick={bulkDispatch.undoAll}
                >
                  {bulkDispatch.isUndoingAll ? "取り消し中..." : "元に戻す"}
                </button>
              )}
              {bulkDispatch.result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-left text-xs text-destructive">
                  {bulkDispatch.result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </p>
          )}
        </div>
      </div>

      <Dialog open={bulkDispatch.confirmOpen} onOpenChange={bulkDispatch.setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>選択した{bulkDispatch.selectedIds.size}件を発送済みにしますか？</DialogTitle>
            <DialogDescription>各注文の予約済みの部品・中間品が実際に消費されます。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => bulkDispatch.setConfirmOpen(false)}>
              戻る
            </Button>
            <Button disabled={bulkDispatch.isDispatching} onClick={bulkDispatch.handleDispatch}>
              {bulkDispatch.isDispatching ? "発送中..." : "発送する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OrderPdfExportContent
        data={pdfExport.data}
        includePicking={pdfExport.includePicking}
        showCancelledItems={showCancelledItems}
      />

      <div className="mb-4 flex flex-wrap items-center gap-6 print:hidden">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showCancelledOrders} onCheckedChange={handleShowCancelledOrdersChange} />
          キャンセル済み注文を表示
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showCancelledItems} onCheckedChange={handleShowCancelledItemsChange} />
          キャンセル済み商品を表示
        </label>
      </div>

      <Card className="py-0 print:hidden">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && data && data.items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              注文はまだありません。「今すぐ同期」で最新の注文を取得できます。
            </p>
          )}

          {!isLoading && !error && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {(pdfExport.selectionMode || bulkDispatch.selectionMode) && <TableHead className="w-8" />}
                  <TableHead>状態</TableHead>
                  <TableHead>注文ID</TableHead>
                  <TableHead>注文日時</TableHead>
                  <TableHead>お客様</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead className="sticky right-0 bg-muted px-2 last:pr-2"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => {
                  // キャンセル済み商品はピッキング対象外のため、完了判定からは除外する
                  const pickableItems = o.items.filter((i) => i.status !== "cancelled");
                  const fullyPicked = pickableItems.length > 0 && pickableItems.every((i) => i.picked);
                  return (
                  <TableRow
                    key={o.id}
                    id={`order-row-${o.unique_key}`}
                    className={cn(
                      "transition-colors duration-1000",
                      o.unique_key === flashKey && "bg-amber-100 dark:bg-amber-500/20"
                    )}
                  >
                    {pdfExport.selectionMode && (
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={pdfExport.selectedKeys.has(o.unique_key)}
                          onChange={(e) => pdfExport.toggleKey(o.unique_key, e.target.checked)}
                        />
                      </TableCell>
                    )}
                    {bulkDispatch.selectionMode && (
                      <TableCell>
                        {o.platform === "manual" && o.dispatch_status === "ordered" && (
                          <input
                            type="checkbox"
                            className="size-3.5 accent-primary"
                            checked={bulkDispatch.selectedIds.has(o.id)}
                            onChange={(e) => bulkDispatch.toggleId(o.id, e.target.checked)}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <OrderStatusCell order={o} fullyPicked={fullyPicked} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <Hint label="この注文の在庫変動履歴を見る">
                          <Link
                            to={`/stock-movements?order=${encodeURIComponent(o.unique_key)}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {o.unique_key}
                          </Link>
                        </Hint>
                        <BaseOrderLinkButton shopId={o.shop_id} uniqueKey={o.unique_key} />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(o.ordered_at)}
                    </TableCell>
                    <TableCell>
                      <div>
                        {o.last_name ?? ""} {o.first_name ?? ""}
                        {!o.last_name && !o.first_name && <span className="text-muted-foreground">-</span>}
                      </div>
                      <div className="text-xs text-muted-foreground-subtle">
                        {o.prefecture ?? ""}
                        {o.address ?? ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const visibleItems = showCancelledItems
                          ? o.items
                          : o.items.filter((item) => item.status !== "cancelled");
                        return visibleItems.length === 0 ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <ul className="flex flex-col gap-1.5 text-xs">
                            {visibleItems.map((item) => {
                              const cancelled = item.status === "cancelled";
                              return (
                                <li key={item.id}>
                                  <div className={cancelled ? "opacity-50 line-through" : ""}>
                                    {item.title ?? item.item_id} × {formatNumber(item.quantity)}
                                    {cancelled && (
                                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground no-underline">
                                        キャンセル
                                      </span>
                                    )}
                                  </div>
                                  {(item.variation || item.options.length > 0) && (
                                    <ul className="mt-0.5 flex flex-col gap-0.5 pl-3 text-muted-foreground-subtle">
                                      {item.variation && <li>種類: {item.variation}</li>}
                                      {item.options.map((opt, i) => (
                                        <li key={i}>
                                          {opt.option_name ?? "?"}: {opt.option_value ?? "?"}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.total_amount != null ? (
                        `¥${formatNumber(o.total_amount)}`
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card px-2 last:pr-2">
                      <OrderRowActions order={o} />
                    </TableCell>
                  </TableRow>
                  );
                })}
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
      {currentShop?.platform === "manual" && (
        <ManualOrderCsvImportDialog
          open={csvImportOpen}
          onOpenChange={setCsvImportOpen}
          shopId={currentShop.id}
          onImported={handleOrdersImported}
        />
      )}
    </div>
  );
}
