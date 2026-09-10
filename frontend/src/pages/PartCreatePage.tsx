import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPart, fetchPart } from "../api/client";
import PartForm, { PART_FORM_ID } from "../components/PartForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PartCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const duplicateId = Number(searchParams.get("duplicate"));
  const hasDuplicateSource = Number.isFinite(duplicateId) && duplicateId > 0;

  const { data: duplicateFrom, isLoading: isDuplicateLoading } = useQuery({
    queryKey: ["parts", duplicateId],
    queryFn: () => fetchPart(duplicateId),
    enabled: hasDuplicateSource,
  });

  const mutation = useMutation({
    mutationFn: createPart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      navigate("/parts");
    },
  });

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">新規部品作成</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            {duplicateFrom
              ? `「${duplicateFrom.name}」を複製して新しい部品を登録します(在庫数・SKUは引き継ぎません)`
              : "新しい部品を登録します"}
          </p>
        </div>
        <Button
          type="submit"
          form={PART_FORM_ID}
          disabled={mutation.isPending || (hasDuplicateSource && isDuplicateLoading)}
          className="self-start"
        >
          {mutation.isPending ? "作成中..." : "作成"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          {hasDuplicateSource && isDuplicateLoading ? (
            <p className="text-sm text-muted-foreground">複製元を読み込み中...</p>
          ) : (
            <PartForm duplicateFrom={duplicateFrom} onSubmit={(input) => mutation.mutate(input)} />
          )}
          {mutation.error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
