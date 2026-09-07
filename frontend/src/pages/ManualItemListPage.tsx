import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MoreVertical, PackageMinus } from "lucide-react";
import { consumeManualItem, deleteManualItem, fetchManualItems } from "@/api/client";
import { useShopContext } from "@/contexts/ShopContext";
import { formatNumber } from "@/lib/format";
import { preventEnterSubmit } from "@/lib/forms";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import type { ManualItem } from "@/types/manualItem";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Hint from "@/components/Hint";

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function yen(value: number | null): string {
  return value == null ? "-" : `¥${formatNumber(value)}`;
}

export default function ManualItemListPage() {
  const { currentShop } = useShopContext();
  const shopId = currentShop?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [itemToDelete, setItemToDelete] = useState<ManualItem | null>(null);
  const [itemToConsume, setItemToConsume] = useState<ManualItem | null>(null);
  const [consumeQuantity, setConsumeQuantity] = useState(1);
  const [consumeVariationId, setConsumeVariationId] = useState<number | "">("");
  const [consumeNote, setConsumeNote] = useState("");
  const consumeFeedback = useSaveFeedback();

  const { data: items, isLoading } = useQuery({
    queryKey: ["manual-items", shopId],
    queryFn: () => fetchManualItems(shopId!),
    enabled: !!shopId && currentShop?.platform === "manual",
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteManualItem(shopId!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual-items", shopId] });
      setItemToDelete(null);
    },
  });

  const consumeMutation = useMutation({
    mutationFn: () => {
      if (!itemToConsume) throw new Error("商品が選択されていません");
      return consumeManualItem(shopId!, itemToConsume.item_id, {
        quantity: consumeQuantity,
        variation_id: consumeVariationId === "" ? null : consumeVariationId,
        note: consumeNote || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual-items", shopId] });
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      consumeFeedback.succeed("consume");
      setTimeout(() => {
        setItemToConsume(null);
        setConsumeQuantity(1);
        setConsumeVariationId("");
        setConsumeNote("");
      }, 500);
    },
  });

  function openConsumeDialog(item: ManualItem) {
    setItemToConsume(item);
    setConsumeQuantity(1);
    setConsumeVariationId("");
    setConsumeNote("");
    consumeMutation.reset();
  }

  function handleConsumeSubmit(e: FormEvent) {
    e.preventDefault();
    consumeMutation.mutate();
  }

  if (!currentShop || currentShop.platform !== "manual") {
    return (
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">商品管理(手動)</h1>
        <p className="mt-4 text-sm text-muted-foreground-subtle">
          この機能は「手動管理(API連携なし)」のショップでのみ使用できます。画面右上のショップ切り替えで対象のショップを選択してください。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">商品管理(手動)</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            「{currentShop.name}」の商品を手動で登録・管理します
          </p>
        </div>
        <Link to="/manual-items/new" className={buttonVariants({ variant: "default" })}>
          新規作成
        </Link>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {!isLoading && (items?.length ?? 0) === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">まだ商品が登録されていません。</p>
          )}
          {!isLoading && items && items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品コード</TableHead>
                  <TableHead>商品名</TableHead>
                  <TableHead className="text-right">価格</TableHead>
                  <TableHead className="text-right">在庫</TableHead>
                  <TableHead>バリエーション</TableHead>
                  <TableHead className="sticky right-0 w-10 bg-muted px-2 last:pr-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.item_id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/manual-items/${item.item_id}/edit`)}
                  >
                    <TableCell className="font-mono text-xs">{item.item_id}</TableCell>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.variations.length > 0 ? (
                        <div className="grid gap-0.5">
                          {item.variations.map((v) => (
                            <div key={v.id} className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                              <span className="text-xs text-muted-foreground-subtle">{v.name}</span>
                              <span>{yen(v.price ?? item.price)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        yen(item.price)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(item.stock)}</TableCell>
                    <TableCell className="text-muted-foreground-subtle">
                      {item.variations.length > 0 ? `${item.variations.length}件` : "-"}
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card px-2 last:pr-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Hint label="在庫を消費する">
                          <span className="inline-flex">
                            <Button variant="ghost" size="icon-sm" onClick={() => openConsumeDialog(item)}>
                              <PackageMinus />
                            </Button>
                          </span>
                        </Hint>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                            aria-label="その他の操作"
                          >
                            <MoreVertical />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => navigate(`/manual-items/new?duplicate=${encodeURIComponent(item.item_id)}`)}
                            >
                              複製して新規作成
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setItemToDelete(item)}>
                              削除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>商品を削除しますか？</DialogTitle>
            <DialogDescription>「{itemToDelete?.title}」を削除します。この操作は取り消せません。</DialogDescription>
          </DialogHeader>
          {deleteMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(deleteMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemToDelete(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete.item_id)}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!itemToConsume} onOpenChange={(open) => !open && setItemToConsume(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{itemToConsume?.title}」の在庫を消費する</DialogTitle>
            <DialogDescription>
              注文を作らずに、この商品の在庫とBOMで紐付いた部品・中間品の在庫をまとめて減らします。
            </DialogDescription>
          </DialogHeader>
          <form
            id="consume-form"
            onSubmit={handleConsumeSubmit}
            onKeyDown={preventEnterSubmit}
            className="grid gap-4"
          >
            {itemToConsume && itemToConsume.variations.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="consume-variation">バリエーション</Label>
                <select
                  id="consume-variation"
                  className={selectClass}
                  value={consumeVariationId}
                  onChange={(e) => setConsumeVariationId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">選択してください</option>
                  {itemToConsume.variations.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}(在庫:{formatNumber(v.stock)})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="consume-quantity">数量</Label>
              <NumberInput
                id="consume-quantity"
                value={String(consumeQuantity)}
                onChange={(v) => setConsumeQuantity(Number(v))}
                className="w-32 text-right"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="consume-note">メモ</Label>
              <Input id="consume-note" value={consumeNote} onChange={(e) => setConsumeNote(e.target.value)} />
            </div>
          </form>
          {consumeMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(consumeMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemToConsume(null)}>
              キャンセル
            </Button>
            <Button
              type="submit"
              form="consume-form"
              disabled={
                consumeMutation.isPending ||
                (!!itemToConsume && itemToConsume.variations.length > 0 && consumeVariationId === "")
              }
            >
              {consumeFeedback.isFlashing("consume") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  消費しました
                </span>
              ) : consumeMutation.isPending ? (
                "処理中..."
              ) : (
                "消費する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
