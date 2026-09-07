import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, MoreVertical, PackageCheck, Pencil } from "lucide-react";
import {
  cancelPurchaseOrder,
  fetchPurchaseOrders,
  receivePurchaseOrder,
  undoReceivePurchaseOrder,
  updatePurchaseOrderUrl,
} from "../api/client";
import { formatDate, formatDateTime, toDatetimeLocalInput } from "@/lib/datetime";
import { useShopContext } from "@/contexts/ShopContext";
import type { PurchaseOrderStatus } from "../types/purchase_order";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { daysElapsed, isOverdue } from "@/lib/purchaseOrder";
import { formatNumber } from "@/lib/format";
import Pagination, { usePageSize } from "../components/Pagination";
import Hint from "@/components/Hint";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";

function OrderUrlCell({ orderId, url }: { orderId: number; url: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(url ?? "");
  const queryClient = useQueryClient();
  const feedback = useSaveFeedback();
  const mutation = useMutation({
    mutationFn: (value: string | null) => updatePurchaseOrderUrl(orderId, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setTimeout(() => setOpen(false), 500);
    },
  });

  function openDialog() {
    setValue(url ?? "");
    setOpen(true);
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Hint label="発注URLを編集">
          <Button variant="ghost" size="icon-sm" onClick={openDialog}>
            <Pencil />
          </Button>
        </Hint>
        {url ? (
          <Hint label="発注先を開く">
            <a href={url} target="_blank" rel="noreferrer" className="text-muted-foreground-subtle hover:text-foreground">
              <ExternalLink className="size-4" />
            </a>
          </Hint>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>発注URL</DialogTitle>
            <DialogDescription>発注先で実際に発注したページのURLを入力してください。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`order-url-${orderId}`}>URL</Label>
            <Input
              id={`order-url-${orderId}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <FieldError message={feedback.errorFor("save")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(value.trim() || null, feedback.callbacks("save"))}
            >
              {feedback.isFlashing("save") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  保存しました
                </span>
              ) : mutation.isPending ? (
                "保存中..."
              ) : (
                "保存"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ordered: "発注中",
  received: "入荷済み",
  cancelled: "キャンセル",
};

const STATUS_CLASS: Record<string, string> = {
  ordered: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  received: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
};

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function StatusBadge({ status }: { status: PurchaseOrderStatus | string }) {
  return (
    <Badge className={cn("border-transparent", STATUS_CLASS[status])}>{STATUS_LABEL[status] ?? status}</Badge>
  );
}

export default function PurchaseOrderListPage() {
  const queryClient = useQueryClient();
  const { shops } = useShopContext();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [status, setStatus] = useState("");
  const [partNameInput, setPartNameInput] = useState("");
  const [partName, setPartName] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight") ? Number(searchParams.get("highlight")) : null;
  const [flashId, setFlashId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setPartName(partNameInput), 300);
    return () => clearTimeout(timer);
  }, [partNameInput]);

  // 発注対象の部品在庫は全ショップ共有のため、発注管理は選択中ショップに関わらず
  // 常に全ショップ分を表示する(どのショップが発注したかは列で分かるようにする)
  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase-orders", page, pageSize, status, partName, highlightId],
    queryFn: () =>
      fetchPurchaseOrders(
        pageSize,
        (page - 1) * pageSize,
        status || undefined,
        partName || undefined,
        highlightId ?? undefined
      ),
    refetchInterval: 10000,
  });

  // リンク経由で特定の発注(?highlight=id)が指定されている場合、サーバーがその発注を
  // 含むページを計算して返してくるので、そのページに合わせてから該当行を一時的に
  // ハイライトしてスクロールする(在庫変動履歴の「発注#N」リンクから遷移してくる)
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
    document
      .getElementById(`purchase-order-row-${flashId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(timer);
  }, [flashId]);

  const [receiveDialogOrderId, setReceiveDialogOrderId] = useState<number | null>(null);
  const [receivedAtInput, setReceivedAtInput] = useState("");

  function openReceiveDialog(orderId: number) {
    setReceivedAtInput(toDatetimeLocalInput());
    setReceiveDialogOrderId(orderId);
  }

  const receiveFeedback = useSaveFeedback();
  const rowFeedback = useSaveFeedback();

  const receiveMutation = useMutation({
    mutationFn: ({ id, receivedAt }: { id: number; receivedAt: string }) =>
      receivePurchaseOrder(id, new Date(receivedAt).toISOString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      queryClient.invalidateQueries({ queryKey: ["reorder-needed"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
      receiveFeedback.succeed("receive");
      setTimeout(() => setReceiveDialogOrderId(null), 500);
    },
  });

  const undoReceiveMutation = useMutation({
    mutationFn: undoReceivePurchaseOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      queryClient.invalidateQueries({ queryKey: ["reorder-needed"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPurchaseOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["reorder-needed"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  useEffect(() => {
    if (!highlightId) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, status, partName]);

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">発注管理</h1>
        <p className="mt-1 text-sm text-muted-foreground-subtle">部品の発注履歴と入荷処理</p>
      </div>

      <div className="mb-8 flex flex-wrap items-end gap-6">
        <div className="grid gap-1.5">
          <Label htmlFor="filter-status">状態</Label>
          <select
            id="filter-status"
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全て</option>
            <option value="ordered">発注中</option>
            <option value="received">入荷済み</option>
            <option value="cancelled">キャンセル</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-part-name">部品名</Label>
          <Input
            id="filter-part-name"
            value={partNameInput}
            onChange={(e) => setPartNameInput(e.target.value)}
            placeholder="部分一致"
            className="w-48"
          />
        </div>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && data && data.items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              該当する発注はありません。ダッシュボードの「発注が必要な部品」から発注できます。
            </p>
          )}

          {!isLoading && !error && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>部品</TableHead>
                  <TableHead>数量</TableHead>
                  <TableHead>ショップ</TableHead>
                  <TableHead>発注日時</TableHead>
                  <TableHead>経過日数</TableHead>
                  <TableHead>納品予定日</TableHead>
                  <TableHead>入荷日時</TableHead>
                  <TableHead>発注URL</TableHead>
                  <TableHead>メモ</TableHead>
                  <TableHead className="sticky right-0 bg-muted px-2 last:pr-2"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => {
                  const overdue = o.status === "ordered" && isOverdue(o.expected_delivery_date);
                  return (
                    <TableRow
                      key={o.id}
                      id={`purchase-order-row-${o.id}`}
                      className={cn(o.id === flashId && "bg-amber-100 dark:bg-amber-500/20")}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">{o.id}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <StatusBadge status={o.status} />
                          {o.status === "ordered" && (
                            <Hint label="入荷">
                              <span className="inline-flex">
                                <Button variant="ghost" size="icon-xs" onClick={() => openReceiveDialog(o.id)}>
                                  <PackageCheck />
                                </Button>
                              </span>
                            </Hint>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link to={`/parts/${o.part_id}/edit`} className="text-primary underline-offset-2 hover:underline">
                          {o.part_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(o.quantity)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {shops.find((s) => s.id === o.shop_id)?.name ?? "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(o.ordered_at)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {o.status === "ordered" ? `${daysElapsed(o.ordered_at)}日` : "-"}
                      </TableCell>
                      <TableCell className={cn("whitespace-nowrap", overdue && "font-medium text-destructive")}>
                        {o.expected_delivery_date ? formatDate(o.expected_delivery_date) : "-"}
                        {overdue && <span className="ml-1.5">(納期超過)</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {o.received_at ? formatDateTime(o.received_at) : "-"}
                      </TableCell>
                      <TableCell>
                        <OrderUrlCell orderId={o.id} url={o.order_url} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{o.note ?? "-"}</TableCell>
                      <TableCell className="sticky right-0 bg-card px-2 last:pr-2">
                        {o.status === "ordered" && (
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
                                  onClick={() =>
                                    cancelMutation.mutate(o.id, rowFeedback.callbacks(`cancel:${o.id}`))
                                  }
                                  disabled={cancelMutation.isPending}
                                >
                                  キャンセル
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {rowFeedback.errorFor(`cancel:${o.id}`) && (
                              <Hint label={rowFeedback.errorFor(`cancel:${o.id}`)}>
                                <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                              </Hint>
                            )}
                          </div>
                        )}
                        {o.status === "received" && (
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
                                  onClick={() =>
                                    undoReceiveMutation.mutate(o.id, rowFeedback.callbacks(`undo:${o.id}`))
                                  }
                                  disabled={undoReceiveMutation.isPending}
                                >
                                  入荷取消し
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {rowFeedback.errorFor(`undo:${o.id}`) && (
                              <Hint label={rowFeedback.errorFor(`undo:${o.id}`)}>
                                <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                              </Hint>
                            )}
                          </div>
                        )}
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

      <Dialog open={receiveDialogOrderId !== null} onOpenChange={(open) => !open && setReceiveDialogOrderId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>入荷</DialogTitle>
            <DialogDescription>実際に入荷した日時を入力してください。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="received_at">入荷日時</Label>
            <Input
              id="received_at"
              type="datetime-local"
              value={receivedAtInput}
              onChange={(e) => setReceivedAtInput(e.target.value)}
              autoFocus
            />
          </div>
          <FieldError message={receiveFeedback.errorFor("receive")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialogOrderId(null)}>
              キャンセル
            </Button>
            <Button
              disabled={!receivedAtInput || receiveMutation.isPending}
              onClick={() =>
                receiveDialogOrderId !== null &&
                receiveMutation.mutate(
                  { id: receiveDialogOrderId, receivedAt: receivedAtInput },
                  receiveFeedback.callbacks("receive")
                )
              }
            >
              {receiveFeedback.isFlashing("receive") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  入荷しました
                </span>
              ) : receiveMutation.isPending ? (
                "処理中..."
              ) : (
                "入荷する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
