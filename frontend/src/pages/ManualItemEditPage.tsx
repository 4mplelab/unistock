import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchManualItems, updateManualItem } from "@/api/client";
import { useShopContext } from "@/contexts/ShopContext";
import type { ManualItemVariationUpsertInput } from "@/types/manualItem";
import ManualItemBasicForm, { MANUAL_ITEM_FORM_ID, type ManualItemBasicInput } from "@/components/ManualItemBasicForm";
import ManualItemVariationEditor from "@/components/ManualItemVariationEditor";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ManualItemEditPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const { currentShop } = useShopContext();
  const shopId = currentShop?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDirty, setIsDirty] = useState(false);
  const blocker = useUnsavedChangesGuard(isDirty);

  const { data: items, isLoading } = useQuery({
    queryKey: ["manual-items", shopId],
    queryFn: () => fetchManualItems(shopId!),
    enabled: !!shopId && currentShop?.platform === "manual",
  });
  const item = items?.find((i) => i.item_id === itemId);

  const [variations, setVariations] = useState<ManualItemVariationUpsertInput[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (item && !seeded) {
      setVariations(
        item.variations.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock, sort_order: v.sort_order }))
      );
      setSeeded(true);
    }
  }, [item, seeded]);

  // バリエーションのダーティ判定。シード完了時のvariationsを基準値として記録し(この
  // 時点ではダーティにしない)、以後それと異なる内容になったら初めてダーティにする
  // (AssemblyEditPageのレシピと同じパターン)
  const variationsBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seeded) return;
    const serialized = JSON.stringify(variations);
    if (variationsBaselineRef.current === null) {
      variationsBaselineRef.current = serialized;
      return;
    }
    if (serialized !== variationsBaselineRef.current) {
      setIsDirty(true);
    }
  }, [variations, seeded]);

  const saveMutation = useMutation({
    mutationFn: (basic: ManualItemBasicInput) =>
      updateManualItem(shopId!, itemId!, {
        title: basic.title,
        price: basic.price,
        stock: basic.stock,
        description: basic.description,
        variations: variations.map((v) => ({
          id: v.id,
          name: v.name,
          price: v.price,
          stock: v.stock,
          sort_order: v.sort_order,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual-items", shopId] });
      setIsDirty(false);
    },
  });

  // isDirtyがfalseになった再描画を経てからnavigateする(保存直後に同期的にnavigateすると、
  // useBlockerがまだ古いisDirty=trueを見て確認ダイアログを誤表示してしまうため)
  useEffect(() => {
    if (saveMutation.isSuccess) navigate("/manual-items");
  }, [saveMutation.isSuccess, navigate]);

  const hasIncompletePrice = variations.some((v) => v.price == null);

  if (!currentShop || currentShop.platform !== "manual") {
    return (
      <p className="text-sm text-muted-foreground-subtle">
        この機能は「手動管理(API連携なし)」のショップでのみ使用できます。
      </p>
    );
  }

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">商品編集(手動)</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">名前・価格・在庫数・バリエーションをまとめて編集します</p>
        </div>
        <Button
          type="submit"
          form={MANUAL_ITEM_FORM_ID}
          disabled={saveMutation.isPending || isLoading || !item || hasIncompletePrice}
        >
          {saveMutation.isPending ? "更新中..." : "更新"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
          {!isLoading && !item && <p className="text-sm text-muted-foreground-subtle">商品が見つかりません。</p>}
          {item && (
            <ManualItemBasicForm
              initial={item}
              hasVariations={variations.length > 0}
              onSubmit={(input) => saveMutation.mutate(input)}
              onDirtyChange={setIsDirty}
            />
          )}
          {saveMutation.error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(saveMutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      {item && (
        <div className="mt-6 max-w-2xl">
          <ManualItemVariationEditor lines={variations} onChange={setVariations} />
        </div>
      )}

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
