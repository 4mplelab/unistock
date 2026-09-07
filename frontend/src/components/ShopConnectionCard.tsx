import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { deleteShop, updateShop } from "@/api/client";
import type { Shop } from "@/types/shop";
import { platformLabel } from "@/lib/platforms";
import ShopOAuthConnect from "@/components/ShopOAuthConnect";
import ShopUrlTemplates from "@/components/ShopUrlTemplates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SaveFlashCheck from "@/components/SaveFlashCheck";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
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
  canDelete,
  isOnlyActiveShop,
}: {
  shop: Shop;
  demoMode: boolean;
  canDelete: boolean;
  // trueの間は有効/無効の切り替えを止める。唯一有効なショップを無効化すると、
  // BOM編集・リストック予約作成などのショップ選択が空になり操作できなくなるため
  isOnlyActiveShop: boolean;
}) {
  const queryClient = useQueryClient();
  const isOAuthPlatform = shop.platform === "base";

  const [nameInput, setNameInput] = useState(shop.name);
  useEffect(() => setNameInput(shop.name), [shop.name]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmManualOpen, setConfirmManualOpen] = useState(false);
  const feedback = useSaveFeedback();

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
    mutationFn: () => deleteShop(shop.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      // 削除完了のチェック表示を一瞬見せてからダイアログを閉じる(即座に閉じると
      // フィードバックが見えないため)
      feedback.succeed("delete");
      setTimeout(() => setConfirmDeleteOpen(false), 500);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
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
              className="h-8 max-w-56"
            />
            <SaveFlashCheck show={feedback.isFlashing("rename")} />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Label htmlFor={`active-${shop.id}`} className="text-xs text-muted-foreground">
              有効
            </Label>
            <SaveFlashCheck show={feedback.isFlashing("active")} />
            <Switch
              id={`active-${shop.id}`}
              checked={shop.is_active}
              onCheckedChange={(checked) => toggleActiveMutation.mutate(checked, feedback.callbacks("active"))}
              disabled={shop.is_active && isOnlyActiveShop}
              title={
                shop.is_active && isOnlyActiveShop
                  ? "唯一の有効なショップです。無効化するとBOM編集等でショップを選べなくなります"
                  : undefined
              }
            />
            {isOAuthPlatform && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmManualOpen(true)}>
                手動管理に切り替える
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={!canDelete}
              title={!canDelete ? "このショップには注文/BOM等のデータが残っているため削除できません" : undefined}
            >
              削除
            </Button>
          </div>
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
      </CardContent>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ショップを削除しますか？</DialogTitle>
            <DialogDescription>
              「{shop.name}」を削除します。この操作は取り消せません。注文/BOM等のデータが残っている場合は削除できません。
            </DialogDescription>
          </DialogHeader>
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
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
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
    </Card>
  );
}
