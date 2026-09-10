import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchAssembly,
  fetchAssemblyRecipe,
  fetchAssemblyStockMovements,
  fetchAssemblyUsages,
  fetchBomItems,
  replaceAssemblyRecipe,
  replaceBomForItem,
  updateAssembly,
} from "../api/client";
import type { AssemblyBomUsage, AssemblyCreateInput, AssemblyRecipeUsage } from "../types/assembly";
import type { BomCondition, BomReplaceLine } from "../types/bom";
import AssemblyForm, { ASSEMBLY_FORM_ID } from "../components/AssemblyForm";
import AssemblyRecipeEditor, { type RecipeLine } from "../components/AssemblyRecipeEditor";
import StockMovementHistoryCard from "../components/StockMovementHistoryCard";
import UnsavedChangesDialog from "../components/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function conditionsSignature(conditions: BomCondition[]): string {
  if (conditions.length === 0) return "common";
  return conditions
    .map((c) => `${c.selector_type}:${c.selector_id}`)
    .sort()
    .join("+");
}

function conditionsLabel(conditions: BomCondition[]): string {
  if (conditions.length === 0) return "共通";
  return conditions.map((c) => `${c.group_name ?? "?"}: ${c.choice_name ?? "?"}`).join(" × ");
}

export default function AssemblyEditPage() {
  const { id } = useParams<{ id: string }>();
  const assemblyId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isDirty, setIsDirty] = useState(false);
  const blocker = useUnsavedChangesGuard(isDirty);

  const { data: assembly, isLoading, error } = useQuery({
    queryKey: ["assemblies", assemblyId],
    queryFn: () => fetchAssembly(assemblyId),
    enabled: Number.isFinite(assemblyId),
  });

  const recipeQuery = useQuery({
    queryKey: ["assembly-recipe", assemblyId],
    queryFn: () => fetchAssemblyRecipe(assemblyId),
    enabled: Number.isFinite(assemblyId),
  });

  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (recipeQuery.data && !seeded) {
      setLines(
        recipeQuery.data.map((r) => ({
          material_type: r.material_type,
          material_id: r.material_id,
          quantity: r.quantity,
        }))
      );
      setSeeded(true);
    }
  }, [recipeQuery.data, seeded]);

  // レシピのダーティ判定。シード完了時のlinesを基準値として記録し(この時点ではダーティに
  // しない)、以後それと異なる内容になったら初めてダーティにする(seededと同じ
  // レンダーでlinesが確定するため、単純に「初回だけ無視する」ガードだと区別できない)
  const recipeBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seeded) return;
    const serialized = JSON.stringify(lines);
    if (recipeBaselineRef.current === null) {
      recipeBaselineRef.current = serialized;
      return;
    }
    if (serialized !== recipeBaselineRef.current) {
      setIsDirty(true);
    }
  }, [lines, seeded]);

  // 基本情報の更新とレシピの保存を1リクエストにまとめ、バックエンド側で1トランザクションにする
  const saveMutation = useMutation({
    mutationFn: (input: AssemblyCreateInput) => updateAssembly(assemblyId, { ...input, recipe: lines }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      queryClient.invalidateQueries({ queryKey: ["assembly-recipe", assemblyId] });
      setIsDirty(false);
    },
  });

  // isDirtyがfalseになった再描画を経てからnavigateする(保存直後に同期的にnavigateすると、
  // useBlockerがまだ古いisDirty=trueを見て確認ダイアログを誤表示してしまうため)
  useEffect(() => {
    if (saveMutation.isSuccess) navigate("/assemblies");
  }, [saveMutation.isSuccess, navigate]);

  // この中間品が実際にどこで使われているか(BOMの行・他の中間品のレシピ)を一覧表示し、
  // それぞれをこの中間品のレシピの個別行に展開して置き換える(中間品→BOM/レシピの変換。
  // BOM編集画面側の「行を選んで中間品にまとめる」の逆方向)。商品を手動選択させる方式は
  // 「使われている箇所を単純に展開したい、オプション行や他の中間品のレシピの場合もある」
  // というフィードバックを受けてやめた
  const { shops } = useShopContext();
  const shopNameById = new Map(shops.map((s) => [s.id, s.name]));

  const usagesQuery = useQuery({
    queryKey: ["assembly-usages", assemblyId],
    queryFn: () => fetchAssemblyUsages(assemblyId),
    enabled: Number.isFinite(assemblyId),
  });

  const [expandBomTarget, setExpandBomTarget] = useState<AssemblyBomUsage | null>(null);
  const [expandRecipeTarget, setExpandRecipeTarget] = useState<AssemblyRecipeUsage | null>(null);

  const expandBomUsageMutation = useMutation({
    mutationFn: async (usage: AssemblyBomUsage) => {
      const recipe = await fetchAssemblyRecipe(assemblyId);
      if (recipe.length === 0) throw new Error("この中間品にはレシピが設定されていません");

      const existing = await fetchBomItems(usage.shop_id, usage.item_id);
      let merged: BomReplaceLine[] = existing
        .filter((b) => b.id !== usage.bom_item_id)
        .map((b) => ({
          component_type: b.component_type,
          part_id: b.part_id,
          assembly_id: b.assembly_id,
          quantity: b.quantity,
          conditions: b.conditions,
        }));
      for (const item of recipe) {
        const newLine: BomReplaceLine = {
          component_type: item.material_type,
          part_id: item.material_type === "part" ? item.material_id : null,
          assembly_id: item.material_type === "assembly" ? item.material_id : null,
          quantity: item.quantity * usage.quantity,
          conditions: usage.conditions,
        };
        const newKey = `${newLine.component_type}:${newLine.part_id ?? newLine.assembly_id ?? ""}:${conditionsSignature(newLine.conditions ?? [])}`;
        const idx = merged.findIndex(
          (l) => `${l.component_type}:${l.part_id ?? l.assembly_id ?? ""}:${conditionsSignature(l.conditions ?? [])}` === newKey
        );
        if (idx >= 0) {
          merged = merged.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + newLine.quantity } : l));
        } else {
          merged = [...merged, newLine];
        }
      }

      return replaceBomForItem(usage.shop_id, usage.item_id, { item_name: usage.item_name, lines: merged });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bom"] });
      queryClient.invalidateQueries({ queryKey: ["assembly-usages", assemblyId] });
      setExpandBomTarget(null);
    },
  });

  const expandRecipeUsageMutation = useMutation({
    mutationFn: async (usage: AssemblyRecipeUsage) => {
      const recipe = await fetchAssemblyRecipe(assemblyId);
      if (recipe.length === 0) throw new Error("この中間品にはレシピが設定されていません");

      const parentRecipe = await fetchAssemblyRecipe(usage.assembly_id);
      let merged = parentRecipe
        .filter((l) => l.id !== usage.assembly_item_id)
        .map((l) => ({ material_type: l.material_type, material_id: l.material_id, quantity: l.quantity }));
      for (const item of recipe) {
        const idx = merged.findIndex(
          (l) => l.material_type === item.material_type && l.material_id === item.material_id
        );
        const addQuantity = item.quantity * usage.quantity;
        if (idx >= 0) {
          merged = merged.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + addQuantity } : l));
        } else {
          merged = [...merged, { material_type: item.material_type, material_id: item.material_id, quantity: addQuantity }];
        }
      }

      return replaceAssemblyRecipe(usage.assembly_id, merged);
    },
    onSuccess: (_, usage) => {
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      queryClient.invalidateQueries({ queryKey: ["assembly-recipe", usage.assembly_id] });
      queryClient.invalidateQueries({ queryKey: ["assembly-usages", assemblyId] });
      setExpandRecipeTarget(null);
    },
  });

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">中間品編集</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            名前・SKU・在庫数・組成(レシピ)をまとめて編集します
          </p>
        </div>
        <Button
          type="submit"
          form={ASSEMBLY_FORM_ID}
          disabled={saveMutation.isPending || isLoading || !assembly}
          className="self-start"
        >
          {saveMutation.isPending ? "更新中..." : "更新"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
          {error && <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>}
          {assembly && (
            <AssemblyForm initial={assembly} onSubmit={(input) => saveMutation.mutate(input)} onDirtyChange={setIsDirty} />
          )}
          {saveMutation.error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(saveMutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      {Number.isFinite(assemblyId) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <AssemblyRecipeEditor assemblyId={assemblyId} lines={lines} onChange={setLines} />

          <StockMovementHistoryCard
            queryKey={["stock-movements", "assembly", assemblyId]}
            fetchPage={(limit, offset) => fetchAssemblyStockMovements(assemblyId, limit, offset)}
            enabled={Number.isFinite(assemblyId)}
          />
        </div>
      )}

      {Number.isFinite(assemblyId) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>使用箇所</CardTitle>
            <CardDescription>
              この中間品が実際に使われているBOMの行・他の中間品のレシピです。「展開する」を押すと、
              その行をこの中間品のレシピの個別の部品/中間品行に置き換えます(中間品自体は削除されません)。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {usagesQuery.isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
            {usagesQuery.error && (
              <p className="text-sm text-destructive">
                読み込みに失敗しました: {(usagesQuery.error as Error).message}
              </p>
            )}
            {usagesQuery.data &&
              usagesQuery.data.bom_items.length === 0 &&
              usagesQuery.data.assembly_items.length === 0 && (
                <p className="text-sm text-muted-foreground">この中間品はどこにも使われていません</p>
              )}

            {usagesQuery.data && usagesQuery.data.bom_items.length > 0 && (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>ショップ</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead>条件</TableHead>
                    <TableHead className="w-20">数量</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usagesQuery.data.bom_items.map((usage) => (
                    <TableRow key={usage.bom_item_id}>
                      <TableCell>{shopNameById.get(usage.shop_id) ?? `#${usage.shop_id}`}</TableCell>
                      <TableCell>{usage.item_name ?? usage.item_id}</TableCell>
                      <TableCell>{conditionsLabel(usage.conditions)}</TableCell>
                      <TableCell className="text-right">{usage.quantity}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setExpandBomTarget(usage)}>
                          展開する
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {usagesQuery.data && usagesQuery.data.assembly_items.length > 0 && (
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>中間品のレシピ</TableHead>
                    <TableHead className="w-20">数量</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usagesQuery.data.assembly_items.map((usage) => (
                    <TableRow key={usage.assembly_item_id}>
                      <TableCell>{usage.assembly_name}</TableCell>
                      <TableCell className="text-right">{usage.quantity}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setExpandRecipeTarget(usage)}>
                          展開する
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!expandBomTarget} onOpenChange={(open) => !open && setExpandBomTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              「{expandBomTarget?.item_name ?? expandBomTarget?.item_id}」({expandBomTarget && conditionsLabel(expandBomTarget.conditions)})
              を展開しますか?
            </DialogTitle>
            <DialogDescription>
              このBOM行を、この中間品のレシピの個別の部品/中間品行に置き換えます。即座に保存されます(中間品自体は削除されません)。
            </DialogDescription>
          </DialogHeader>
          {expandBomUsageMutation.error && (
            <p className="text-sm text-destructive">{(expandBomUsageMutation.error as Error).message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpandBomTarget(null)}>
              キャンセル
            </Button>
            <Button
              disabled={expandBomUsageMutation.isPending}
              onClick={() => expandBomTarget && expandBomUsageMutation.mutate(expandBomTarget)}
            >
              {expandBomUsageMutation.isPending ? "展開中..." : "展開する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!expandRecipeTarget} onOpenChange={(open) => !open && setExpandRecipeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{expandRecipeTarget?.assembly_name}」のレシピで展開しますか?</DialogTitle>
            <DialogDescription>
              この中間品を材料として使っているレシピ行を、この中間品のレシピの個別の部品/中間品行に置き換えます。即座に保存されます(中間品自体は削除されません)。
            </DialogDescription>
          </DialogHeader>
          {expandRecipeUsageMutation.error && (
            <p className="text-sm text-destructive">{(expandRecipeUsageMutation.error as Error).message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpandRecipeTarget(null)}>
              キャンセル
            </Button>
            <Button
              disabled={expandRecipeUsageMutation.isPending}
              onClick={() => expandRecipeTarget && expandRecipeUsageMutation.mutate(expandRecipeTarget)}
            >
              {expandRecipeUsageMutation.isPending ? "展開中..." : "展開する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
