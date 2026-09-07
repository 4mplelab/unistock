import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ReservingOrder } from "../types/order_reservation";

export function reservingOrdersQueryKey(id: number) {
  return ["reserving-orders", id] as const;
}

/**
 * 引当バッジのクリックを扱う。引当中の注文が1件だけなら無条件でピッキング画面に
 * 遷移し、複数件ある場合だけダイアログで選ばせる(ReservingOrdersDialogの内部
 * useQueryと同じqueryKeyでprefetchするため、ダイアログを開く場合も二重取得しない)。
 */
export function useReservationLookup(fetchReservations: (id: number) => Promise<ReservingOrder[]>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return async function openOrNavigate(
    target: { id: number; name: string },
    openDialog: (target: { id: number; name: string }) => void
  ) {
    const orders = await queryClient.fetchQuery({
      queryKey: reservingOrdersQueryKey(target.id),
      queryFn: () => fetchReservations(target.id),
    });
    if (orders.length === 1) {
      navigate(`/picking?highlight=${encodeURIComponent(orders[0].unique_key)}`);
    } else {
      openDialog(target);
    }
  };
}
