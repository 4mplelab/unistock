import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { fetchSchedule, updateSchedule } from "../api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { toDatetimeLocalInput } from "@/lib/datetime";
import { preventEnterSubmit } from "@/lib/forms";
import UnsavedChangesDialog from "../components/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

const FORM_ID = "schedule-edit-form";

export default function ScheduleEditPage() {
  const { id } = useParams<{ id: string }>();
  const scheduleId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDirty, setIsDirty] = useState(false);
  const blocker = useUnsavedChangesGuard(isDirty);

  const { data: schedule, isLoading, error } = useQuery({
    queryKey: ["schedules", scheduleId],
    queryFn: () => fetchSchedule(scheduleId),
    enabled: Number.isFinite(scheduleId),
  });

  const [targetStock, setTargetStock] = useState(0);
  const [runAt, setRunAt] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (schedule && !seeded) {
      setTargetStock(schedule.target_stock);
      setRunAt(toDatetimeLocalInput(schedule.run_at));
      setSeeded(true);
    }
  }, [schedule, seeded]);

  // シード完了時の値を基準値として記録し(この時点ではダーティにしない)、以後それと
  // 異なる内容になったら初めてダーティにする(targetStock/runAtの初期化とシードが
  // 別タイミングのため、単純に「初回だけ無視する」ガードだと区別できない)
  const baselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seeded) return;
    const serialized = JSON.stringify({ targetStock, runAt });
    if (baselineRef.current === null) {
      baselineRef.current = serialized;
      return;
    }
    if (serialized !== baselineRef.current) {
      setIsDirty(true);
    }
  }, [targetStock, runAt, seeded]);

  const mutation = useMutation({
    mutationFn: () => updateSchedule(scheduleId, { target_stock: targetStock, run_at: new Date(runAt).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      setIsDirty(false);
    },
  });

  // isDirtyがfalseになった再描画を経てからnavigateする(保存直後に同期的にnavigateすると、
  // useBlockerがまだ古いisDirty=trueを見て確認ダイアログを誤表示してしまうため)
  useEffect(() => {
    if (mutation.isSuccess) navigate("/schedules");
  }, [mutation.isSuccess, navigate]);

  // noValidateでブラウザのdatetime-local書式チェックを無効化しているため、
  // 「空でない」だけでなく実際にパースできる日時かどうかも自前で確認する
  const runAtDate = runAt ? new Date(runAt) : null;
  const isRunAtValid = !!runAtDate && !isNaN(runAtDate.getTime());

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (!isRunAtValid) return;
    mutation.mutate();
  }

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">リストック予約編集</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">待機中(実行前)のスケジュールのみ編集できます</p>
        </div>
        <Button
          type="submit"
          form={FORM_ID}
          disabled={mutation.isPending || isLoading || !schedule}
          className="self-start"
        >
          {mutation.isPending ? "更新中..." : "更新"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
          {error && <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>}

          {schedule && (
            <form id={FORM_ID} onSubmit={handleSubmit} onKeyDown={preventEnterSubmit} noValidate className="grid gap-5">
              <div className="grid gap-1.5">
                <Label>商品</Label>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-sm font-medium">
                    {schedule.item_name ?? <span className="text-muted-foreground">-</span>}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{schedule.item_id}</div>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="target_stock">
                  在庫数 <span className="text-destructive">*</span>
                </Label>
                <NumberInput
                  id="target_stock"
                  value={String(targetStock)}
                  onChange={(v) => setTargetStock(Number(v))}
                  required
                  className="w-32 text-right"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="run_at">
                  実行日時 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="run_at"
                  type="datetime-local"
                  value={runAt}
                  onChange={(e) => setRunAt(e.target.value)}
                  aria-invalid={hasAttemptedSubmit && !isRunAtValid}
                  required
                  className="w-56"
                />
              </div>
            </form>
          )}
          {mutation.error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
