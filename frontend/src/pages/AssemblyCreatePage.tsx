import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createAssembly, fetchAssembly, fetchAssemblyRecipe } from "../api/client";
import type { AssemblyCreateInput } from "../types/assembly";
import AssemblyForm, { ASSEMBLY_FORM_ID } from "../components/AssemblyForm";
import AssemblyRecipeEditor, { type RecipeLine } from "../components/AssemblyRecipeEditor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AssemblyCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const duplicateId = Number(searchParams.get("duplicate"));
  const hasDuplicateSource = Number.isFinite(duplicateId) && duplicateId > 0;

  const { data: duplicateFrom, isLoading: isDuplicateLoading } = useQuery({
    queryKey: ["assemblies", duplicateId],
    queryFn: () => fetchAssembly(duplicateId),
    enabled: hasDuplicateSource,
  });
  const duplicateRecipeQuery = useQuery({
    queryKey: ["assembly-recipe", duplicateId],
    queryFn: () => fetchAssemblyRecipe(duplicateId),
    enabled: hasDuplicateSource,
  });

  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [recipeSeeded, setRecipeSeeded] = useState(false);

  // 複製元の組成(レシピ)行をそのまま初期値として引き継ぐ
  useEffect(() => {
    if (duplicateRecipeQuery.data && !recipeSeeded) {
      setLines(
        duplicateRecipeQuery.data.map((r) => ({
          material_type: r.material_type,
          material_id: r.material_id,
          quantity: r.quantity,
        }))
      );
      setRecipeSeeded(true);
    }
  }, [duplicateRecipeQuery.data, recipeSeeded]);

  // 中間品の作成と組成(レシピ)の登録を1リクエストにまとめ、バックエンド側で1トランザクションにする
  const mutation = useMutation({
    mutationFn: (input: AssemblyCreateInput) => createAssembly({ ...input, recipe: lines }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      navigate("/assemblies");
    },
  });

  const isDuplicateSourceLoading = hasDuplicateSource && (isDuplicateLoading || !recipeSeeded);

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">新規中間品作成</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            {duplicateFrom
              ? `「${duplicateFrom.name}」を複製して新しい中間品を登録します(在庫数・SKUは引き継ぎません)`
              : "新しい中間品を登録します。組成(レシピ)も一緒に登録できます"}
          </p>
        </div>
        <Button
          type="submit"
          form={ASSEMBLY_FORM_ID}
          disabled={mutation.isPending || isDuplicateSourceLoading}
          className="self-start"
        >
          {mutation.isPending ? "作成中..." : "作成"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          {isDuplicateSourceLoading ? (
            <p className="text-sm text-muted-foreground">複製元を読み込み中...</p>
          ) : (
            <AssemblyForm duplicateFrom={duplicateFrom} onSubmit={(input) => mutation.mutate(input)} />
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
          <AssemblyRecipeEditor assemblyId={null} lines={lines} onChange={setLines} />
        </div>
      )}
    </div>
  );
}
