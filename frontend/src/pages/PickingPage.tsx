import { useQuery } from "@tanstack/react-query";
import { fetchOrderSummary } from "../api/client";
import { useShopContext } from "@/contexts/ShopContext";
import OrderPickListPanel, { PickingPrintToolbar, usePickingPrint } from "../components/OrderPickListPanel";

export default function PickingPage() {
  const pick = usePickingPrint();
  const { currentShopId } = useShopContext();
  // ツールバーの「印刷」ボタンの活性判定にだけ使う。一覧本体(OrderPickListPanel)と
  // 同じqueryKeyのためキャッシュを共有し、追加の通信は発生しない
  const { data } = useQuery({
    queryKey: ["order-summary", currentShopId],
    queryFn: () => fetchOrderSummary(undefined, undefined, currentShopId ?? undefined),
  });

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ピッキング</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            未対応の注文と、その注文が消費する部品・中間品の一覧です
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-start print:hidden">
          <PickingPrintToolbar {...pick} disabled={(data?.orders.length ?? 0) === 0} />
        </div>
      </div>

      <OrderPickListPanel pick={pick} />
    </div>
  );
}
