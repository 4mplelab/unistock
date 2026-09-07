import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createManualItem, fetchManualItems } from "@/api/client";
import { useShopContext } from "@/contexts/ShopContext";
import type { ManualItemVariationUpsertInput } from "@/types/manualItem";
import ManualItemBasicForm, { MANUAL_ITEM_FORM_ID, type ManualItemBasicInput } from "@/components/ManualItemBasicForm";
import ManualItemVariationEditor from "@/components/ManualItemVariationEditor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ManualItemCreatePage() {
  const { currentShop } = useShopContext();
  const shopId = currentShop?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const duplicateId = searchParams.get("duplicate");
  const hasDuplicateSource = !!duplicateId;

  const itemsQuery = useQuery({
    queryKey: ["manual-items", shopId],
    queryFn: () => fetchManualItems(shopId!),
    enabled: !!shopId && hasDuplicateSource,
  });
  const duplicateFrom = itemsQuery.data?.find((i) => i.item_id === duplicateId);

  const [variations, setVariations] = useState<ManualItemVariationUpsertInput[]>([]);
  const [variationsSeeded, setVariationsSeeded] = useState(false);

  // 複製元のバリエーションをそのまま初期値として引き継ぐ(在庫数は0にリセットする。
  // 商品本体の在庫数を複製元から引き継がないのと同じ扱い)
  useEffect(() => {
    if (duplicateFrom && !variationsSeeded) {
      setVariations(duplicateFrom.variations.map((v) => ({ name: v.name, price: v.price, stock: 0 })));
      setVariationsSeeded(true);
    }
  }, [duplicateFrom, variationsSeeded]);

  const isDuplicateSourceLoading = hasDuplicateSource && (itemsQuery.isLoading || !variationsSeeded);
  const hasIncompletePrice = variations.some((v) => v.price == null);

  const mutation = useMutation({
    mutationFn: (basic: ManualItemBasicInput) =>
      createManualItem(shopId!, {
        item_id: basic.item_id!,
        title: basic.title,
        price: basic.price,
        stock: basic.stock,
        description: basic.description,
        variations: variations.map((v) => ({ name: v.name, price: v.price, stock: v.stock })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual-items", shopId] });
      navigate("/manual-items");
    },
  });

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
          <h1 className="text-3xl font-semibold tracking-tight">新規商品作成(手動)</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            {duplicateFrom
              ? `「${duplicateFrom.title}」を複製して新しい商品を登録します(商品コード・在庫数は引き継ぎません)`
              : "このショップには外部ECサイトとの連携が無いため、商品情報をここで直接登録します"}
          </p>
        </div>
        <Button
          type="submit"
          form={MANUAL_ITEM_FORM_ID}
          disabled={mutation.isPending || isDuplicateSourceLoading || hasIncompletePrice}
        >
          {mutation.isPending ? "作成中..." : "作成"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          {isDuplicateSourceLoading ? (
            <p className="text-sm text-muted-foreground">複製元を読み込み中...</p>
          ) : (
            <ManualItemBasicForm
              duplicateFrom={duplicateFrom}
              hasVariations={variations.length > 0}
              onSubmit={(input) => mutation.mutate(input)}
            />
          )}
          {mutation.error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      {!isDuplicateSourceLoading && (
        <div className="mt-6 max-w-2xl">
          <ManualItemVariationEditor lines={variations} onChange={setVariations} />
        </div>
      )}
    </div>
  );
}
