import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MoreVertical } from "lucide-react";
import {
  deleteShop,
  fetchRecalculateCostsPhrase,
  fetchShopDeletePhrase,
  recalculateCosts,
  updateShop,
} from "@/api/client";
import type { Shop } from "@/types/shop";
import { platformLabel } from "@/lib/platforms";
import ShopOAuthConnect from "@/components/ShopOAuthConnect";
import ShopUrlTemplates from "@/components/ShopUrlTemplates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SaveFlashCheck from "@/components/SaveFlashCheck";
import FieldError from "@/components/FieldError";
import Hint from "@/components/Hint";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ShopConnectionCard({
  shop,
  demoMode,
  isOnlyActiveShop,
}: {
  shop: Shop;
  demoMode: boolean;
  // trueの間は有効/無効の切り替えを止める。唯一有効なショップを無効化すると、
  // BOM編集・リストック予約作成などのショップ選択が空になり操作できなくなるため
  isOnlyActiveShop: boolean;
}) {
  const queryClient = useQueryClient();
  const isOAuthPlatform = shop.platform === "base";

  const [nameInput, setNameInput] = useState(shop.name);
  useEffect(() => setNameInput(shop.name), [shop.name]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [confirmManualOpen, setConfirmManualOpen] = useState(false);
  const [confirmCostsOpen, setConfirmCostsOpen] = useState(false);
  const [costsConfirmInput, setCostsConfirmInput] = useState("");
  const feedback = useSaveFeedback();

  const { data: deletePhrase } = useQuery({
    queryKey: ["shop-delete-phrase"],
    queryFn: fetchShopDeletePhrase,
    enabled: confirmDeleteOpen,
  });

  const { data: costsPhrase } = useQuery({
    queryKey: ["recalculate-costs-phrase"],
    queryFn: fetchRecalculateCostsPhrase,
    enabled: confirmCostsOpen,
  });

  const convertToManualMutation = useMutation({
    mutationFn: () => updateShop(shop.id, { platform: "manual" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      setConfirmManualOpen(false);
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => updateShop(shop.id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shops"] }),
  });
  const toggleActiveMutation = useMutation({
    mutationFn: (is_active: boolean) => updateShop(shop.id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shops"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (phrase: string) => deleteShop(shop.id, phrase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      // 削除完了のチェック表示を一瞬見せてからダイアログを閉じる(即座に閉じると
      // フィードバックが見えないため)
      feedback.succeed("delete");
      setTimeout(() => setConfirmDeleteOpen(false), 500);
    },
  });

  function openDeleteDialog() {
    setConfirmDeleteOpen(true);
    setDeleteConfirmInput("");
    deleteMutation.reset();
  }

  const recalculateCostsMutation = useMutation({
    mutationFn: (phrase: string) => recalculateCosts(shop.id, phrase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-summary"] });
    },
  });

  function openCostsDialog() {
    setConfirmCostsOpen(true);
    setCostsConfirmInput("");
    recalculateCostsMutation.reset();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-auto items-center gap-2">
            <Badge variant="secondary" className="shrink-0">
              {platformLabel(shop.platform)}
            </Badge>
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() =>
                nameInput.trim() &&
                nameInput !== shop.name &&
                renameMutation.mutate(nameInput.trim(), feedback.callbacks("rename"))
              }
              className="h-8 min-w-32 max-w-56 flex-1"
            />
            <SaveFlashCheck show={feedback.isFlashing("rename")} />
            <Hint
              label={
                shop.is_active && isOnlyActiveShop
                  ? "唯一の有効なショップです。無効化するとBOM編集等でショップを選べなくなります"
                  : shop.is_active
                    ? "有効"
                    : "無効"
              }
            >
              <span className="inline-flex shrink-0">
                <Switch
                  id={`active-${shop.id}`}
                  aria-label="有効"
                  checked={shop.is_active}
                  onCheckedChange={(checked) => toggleActiveMutation.mutate(checked, feedback.callbacks("active"))}
                  disabled={shop.is_active && isOnlyActiveShop}
                />
              </span>
            </Hint>
            <SaveFlashCheck show={feedback.isFlashing("active")} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              aria-label="その他の操作"
            >
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {isOAuthPlatform && (
                <DropdownMenuItem onClick={() => setConfirmManualOpen(true)}>手動管理に切り替える</DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={openDeleteDialog}>
                削除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <FieldError message={feedback.errorFor("rename")} />
        <FieldError message={feedback.errorFor("active")} />
      </CardHeader>
      <CardContent className="grid gap-4">
        {shop.platform === "manual" ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            外部連携なしのショップです。商品・注文は
            <Link to="/manual-items" className="underline underline-offset-2">
              商品管理(手動)
            </Link>
            と
            <Link to="/orders" className="underline underline-offset-2">
              注文
            </Link>
            画面から直接登録・管理します。
          </p>
        ) : !isOAuthPlatform ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {platformLabel(shop.platform)}の連携は未実装です
          </p>
        ) : (
          <ShopOAuthConnect shopId={shop.id} demoMode={demoMode} />
        )}

        <ShopUrlTemplates shopId={shop.id} demoMode={demoMode} platform={shop.platform} />

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div>
            <div className="text-sm font-medium">原価を再計算する</div>
            <p className="text-xs text-muted-foreground">
              発送確定済みの全注文の原価を、現在の部品・中間品の単価で再計算し直します
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={openCostsDialog} disabled={demoMode}>
            再計算する
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ショップを削除しますか？</DialogTitle>
            <DialogDescription>
              「{shop.name}」と、紐づく注文・BOM・発注・リストック予約・手動登録商品・在庫変動履歴などのデータを
              全て完全に削除します。部品・中間品マスタ自体は他ショップと共有のため削除されません。
              この操作は取り消せません。続ける場合は下に「{deletePhrase?.phrase ?? "..."}」と入力してください。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deleteConfirmInput}
            onChange={(e) => setDeleteConfirmInput(e.target.value)}
            placeholder={deletePhrase?.phrase}
          />
          {deleteMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(deleteMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={!deletePhrase || deleteConfirmInput !== deletePhrase.phrase || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteConfirmInput)}
            >
              {feedback.isFlashing("delete") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  削除しました
                </span>
              ) : deleteMutation.isPending ? (
                "削除中..."
              ) : (
                "削除する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmManualOpen} onOpenChange={setConfirmManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手動管理に切り替えますか？</DialogTitle>
            <DialogDescription>
              「{shop.name}」をBASEとの連携無しの手動管理ショップに切り替えます。連携情報(認証)は削除され、以後は
              商品管理(手動)画面での商品登録と、注文一覧からの手動登録・CSVインポートで運用します。
              既存のBOM・注文データはそのまま残りますが、商品マスタ(商品名・価格・在庫)は新たに登録し直す必要があります。この操作は元に戻せません。
            </DialogDescription>
          </DialogHeader>
          {convertToManualMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(convertToManualMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmManualOpen(false)}>
              キャンセル
            </Button>
            <Button disabled={convertToManualMutation.isPending} onClick={() => convertToManualMutation.mutate()}>
              {convertToManualMutation.isPending ? "切り替え中..." : "手動管理に切り替える"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmCostsOpen} onOpenChange={setConfirmCostsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>原価を再計算しますか？</DialogTitle>
            <DialogDescription>
              「{shop.name}」の発送確定済み全注文の原価を、現在の部品・中間品の単価で再計算して上書きします。
              過去の売上ページに表示される粗利の実績値が変わります。この操作は取り消せません。
              続ける場合は下に「{costsPhrase?.phrase ?? "..."}」と入力してください。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={costsConfirmInput}
            onChange={(e) => setCostsConfirmInput(e.target.value)}
            placeholder={costsPhrase?.phrase}
          />
          {recalculateCostsMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(recalculateCostsMutation.error as Error).message}
            </p>
          )}
          {recalculateCostsMutation.isSuccess && (
            <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
              {recalculateCostsMutation.data.updated_count}件の商品明細を再計算しました
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCostsOpen(false)}>
              閉じる
            </Button>
            <Button
              variant="destructive"
              disabled={!costsPhrase || costsConfirmInput !== costsPhrase.phrase || recalculateCostsMutation.isPending}
              onClick={() => recalculateCostsMutation.mutate(costsConfirmInput)}
            >
              {recalculateCostsMutation.isPending ? "再計算中..." : "再計算する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
