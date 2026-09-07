import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createSchedule } from "../api/client";
import ScheduleForm, { SCHEDULE_CREATE_FORM_ID } from "../components/ScheduleForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ScheduleCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  const mutation = useMutation({
    mutationFn: createSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      navigate("/schedules");
    },
  });

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">新規リストック予約作成</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">指定した日時にショップの在庫数を自動更新します</p>
        </div>
        <Button type="submit" form={SCHEDULE_CREATE_FORM_ID} disabled={mutation.isPending || !ready}>
          {mutation.isPending ? "登録中..." : "スケジュール作成"}
        </Button>
      </div>

      <Card className="max-w-md">
        <CardContent className="pt-6">
          <ScheduleForm onSubmit={(input) => mutation.mutate(input)} onReadyChange={setReady} />
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
