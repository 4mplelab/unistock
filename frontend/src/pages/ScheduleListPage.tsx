import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelSchedule, fetchSchedules } from "../api/client";
import { useShopContext } from "@/contexts/ShopContext";
import type { ScheduleStatus } from "../types/schedule";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatDateTime } from "@/lib/datetime";
import { formatNumber } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  pending: "待機中",
  running: "実行中",
  success: "成功",
  failed: "失敗",
  cancelled: "取消済み",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  running: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: ScheduleStatus | string }) {
  return (
    <Badge className={cn("border-transparent", STATUS_CLASS[status])}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export default function ScheduleListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const { currentShopId } = useShopContext();

  const { data, isLoading, error } = useQuery({
    queryKey: ["schedules", page, pageSize, currentShopId],
    queryFn: () => fetchSchedules(pageSize, (page - 1) * pageSize, currentShopId ?? undefined),
    refetchInterval: 10000,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">リストック予約</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            登録済みのリストック予約と実行結果
          </p>
        </div>
        <Link to="/schedules/new" className={buttonVariants({ variant: "default" })}>
          新規作成
        </Link>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && data && data.items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              スケジュールはまだありません。右上の「新規作成」から登録してください。
            </p>
          )}

          {!isLoading && !error && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>状態</TableHead>
                  <TableHead>商品ID</TableHead>
                  <TableHead>商品名</TableHead>
                  <TableHead>在庫数</TableHead>
                  <TableHead>実行日時</TableHead>
                  <TableHead>結果</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => {
                  const editable = s.status === "pending";
                  return (
                    <TableRow
                      key={s.id}
                      className={cn(editable && "cursor-pointer")}
                      onClick={() => editable && navigate(`/schedules/${s.id}/edit`)}
                    >
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.item_id}</TableCell>
                      <TableCell>{s.item_name ?? <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(s.target_stock)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(s.run_at)}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                        {s.result_message ?? "-"}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {editable && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => cancelMutation.mutate(s.id)}
                            disabled={cancelMutation.isPending}
                          >
                            キャンセル
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  );
}
