import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { fetchPart, fetchPartStockMovements, updatePart } from "../api/client";
import type { PartCreateInput } from "../types/part";
import PartForm, { PART_FORM_ID } from "../components/PartForm";
import StockMovementHistoryCard from "../components/StockMovementHistoryCard";
import UnsavedChangesDialog from "../components/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PartEditPage() {
  const { id } = useParams<{ id: string }>();
  const partId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isDirty, setIsDirty] = useState(false);
  const blocker = useUnsavedChangesGuard(isDirty);

  const { data: part, isLoading, error } = useQuery({
    queryKey: ["parts", partId],
    queryFn: () => fetchPart(partId),
    enabled: Number.isFinite(partId),
  });

  const mutation = useMutation({
    mutationFn: (input: PartCreateInput) => updatePart(partId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      setIsDirty(false);
    },
  });

  // isDirtyがfalseになった再描画を経てからnavigateする(保存直後に同期的にnavigateすると、
  // useBlockerがまだ古いisDirty=trueを見て確認ダイアログを誤表示してしまうため)
  useEffect(() => {
    if (mutation.isSuccess) navigate("/parts");
  }, [mutation.isSuccess, navigate]);

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">部品編集</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">名前・SKU・在庫数などを編集します</p>
        </div>
        <Button
          type="submit"
          form={PART_FORM_ID}
          disabled={mutation.isPending || isLoading || !part}
          className="self-start"
        >
          {mutation.isPending ? "更新中..." : "更新"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
            {error && (
              <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>
            )}
            {part && (
              <PartForm initial={part} onSubmit={(input) => mutation.mutate(input)} onDirtyChange={setIsDirty} />
            )}
            {mutation.error && (
              <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {(mutation.error as Error).message}
              </p>
            )}
          </CardContent>
        </Card>

        {Number.isFinite(partId) && (
          <StockMovementHistoryCard
            queryKey={["stock-movements", "part", partId]}
            fetchPage={(limit, offset) => fetchPartStockMovements(partId, limit, offset)}
            enabled={Number.isFinite(partId)}
          />
        )}
      </div>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
