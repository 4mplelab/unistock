import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import OrderStatusBadge from "./OrderStatusBadge";
import type { ReservingOrder } from "../types/order_reservation";
import { formatDateTime } from "@/lib/datetime";
import { formatNumber } from "@/lib/format";

interface Props {
  target: { id: number; name: string } | null;
  onClose: () => void;
  fetchReservations: (id: number) => Promise<ReservingOrder[]>;
}

export default function ReservingOrdersDialog({ target, onClose, fetchReservations }: Props) {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["reserving-orders", target?.id],
    queryFn: () => fetchReservations(target!.id),
    enabled: !!target,
  });

  function goToOrder(uniqueKey: string) {
    onClose();
    navigate(`/picking?highlight=${encodeURIComponent(uniqueKey)}`);
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>引当中の注文</DialogTitle>
          <DialogDescription>
            「{target?.name}」を現在引当中(未消費・未解放)の注文一覧です。行をクリックするとピッキング画面に移動します。
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">読み込み中...</p>}
        {error && (
          <p className="py-6 text-center text-sm text-destructive">
            読み込みに失敗しました: {(error as Error).message}
          </p>
        )}
        {!isLoading && !error && (!data || data.length === 0) && (
          <p className="py-6 text-center text-sm text-muted-foreground">引当中の注文はありません。</p>
        )}
        {!isLoading && !error && data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状態</TableHead>
                <TableHead>注文ID</TableHead>
                <TableHead>注文日時</TableHead>
                <TableHead>数量</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((o) => (
                <TableRow key={o.order_id} className="cursor-pointer" onClick={() => goToOrder(o.unique_key)}>
                  <TableCell>
                    <OrderStatusBadge status={o.dispatch_status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.unique_key}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(o.ordered_at)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(o.quantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
