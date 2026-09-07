import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Pagination, { usePageSize } from "./Pagination";
import type { StockMovementListResult, StockMovementReason } from "../types/stock_movement";
import { formatDateTime } from "@/lib/datetime";
import { formatSignedNumber } from "@/lib/format";

export const REASON_LABEL: Record<StockMovementReason, string> = {
  manual_edit: "手動修正",
  add_stock: "在庫追加",
  purchase_order_received: "発注入荷",
  purchase_order_receive_undone: "入荷取消し",
  order_consumed: "注文消費",
  order_dispatch_undone: "発送取消し",
  assembly_build: "組立",
  assembly_build_material: "組立材料消費",
  manual_item_consumed: "手動商品の消費",
};

interface Props {
  queryKey: unknown[];
  fetchPage: (limit: number, offset: number) => Promise<StockMovementListResult>;
  enabled: boolean;
}

export default function StockMovementHistoryCard({ queryKey, fetchPage, enabled }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const { data } = useQuery({
    queryKey: [...queryKey, page, pageSize],
    queryFn: () => fetchPage(pageSize, (page - 1) * pageSize),
    enabled,
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <Card className="flex h-full flex-col py-0">
      <CardHeader className="pt-6">
        <CardTitle>在庫変動履歴</CardTitle>
        <CardDescription>
          手動修正・在庫追加・発注入荷・注文消費・組立など、在庫数が変わった操作をすべて記録します
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-0">
        <div className="flex-1">
          {data && data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>種別</TableHead>
                <TableHead>数量</TableHead>
                <TableHead>メモ</TableHead>
                <TableHead>関連</TableHead>
                <TableHead>日時</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{REASON_LABEL[m.reason] ?? m.reason}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSignedNumber(m.quantity)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.note ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {m.order_unique_key ? (
                      <Link
                        to={`/orders?highlight=${encodeURIComponent(m.order_unique_key)}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {m.order_unique_key}
                      </Link>
                    ) : m.purchase_order_id ? (
                      <Link
                        to={`/purchase-orders?highlight=${m.purchase_order_id}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        発注#{m.purchase_order_id}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground-subtle">-</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(m.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          ) : (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">まだ在庫変動履歴はありません。</p>
          )}
        </div>
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
  );
}
