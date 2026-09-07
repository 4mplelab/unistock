import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { fetchOrderSummary, updateOrderItemPicked } from "../api/client";
import { useShopContext } from "@/contexts/ShopContext";
import BaseOrderLinkButton from "./BaseOrderLinkButton";
import type { OrderSummaryRow, PickListEntry } from "../types/order_summary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PickEntryLabel from "@/components/PickEntryLabel";
import PickListPrintTable from "@/components/PickListPrintTable";
import Hint from "@/components/Hint";
import { printWithTitle, todayStamp } from "@/lib/printWithTitle";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/datetime";
import { formatNumber } from "@/lib/format";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";

function pickingProgress(order: OrderSummaryRow) {
  // BASE側で商品単位キャンセルされた行はピッキング不要なので対象外にする
  const targetItems = order.items.filter((i) => i.status !== "cancelled");
  const total = targetItems.length;
  const picked = targetItems.filter((i) => i.picked).length;
  return { picked, total, fullyPicked: total > 0 && picked === total };
}

// ピッキング済みの商品は「まだ集める必要がある数量」から除外して集計する
function computeRemainingAggregate(orders: OrderSummaryRow[]): PickListEntry[] {
  const map = new Map<string, PickListEntry>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.picked) continue;
      for (const entry of item.pick_list) {
        const key = `${entry.component_type}-${entry.id}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantity += entry.quantity;
        } else {
          map.set(key, { ...entry });
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.component_type === b.component_type
      ? a.name.localeCompare(b.name)
      : a.component_type.localeCompare(b.component_type)
  );
}

// 印刷対象の選択・印刷実行をまとめて管理するフック。ツールバー(PickingPrintToolbar、
// ページ見出しと同じ行に置く)とパネル本体(OrderPickListPanel、チェックボックス・
// print:hiddenの絞り込みに使う)の両方から同じ状態を参照できるよう、PickingPage側で
// 1度だけ呼び出し、両コンポーネントにpropsとして渡す
export function usePickingPrint() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [seenKeys, setSeenKeys] = useState<Set<string>>(new Set());
  // nullなら全件印刷、Setを入れるとその注文だけに絞って印刷する
  // (他の注文はprint:hiddenで印刷時のみ非表示にする)
  const [printOnlyKeys, setPrintOnlyKeys] = useState<Set<string> | null>(null);

  // 印刷ダイアログが閉じたら(印刷してもキャンセルしても)、注文の絞り込みを解除する
  useEffect(() => {
    function handleAfterPrint() {
      setPrintOnlyKeys(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  // このページは未対応の注文しか表示しないため、まだ見ていない注文は全てデフォルトで
  // チェックする(注文ページのように状態で絞り込む必要が無い)
  function seedDefaults(uniqueKeys: string[]) {
    const newlySeen = uniqueKeys.filter((k) => !seenKeys.has(k));
    if (newlySeen.length === 0) return;
    setSeenKeys((prev) => new Set([...prev, ...newlySeen]));
    setSelectedKeys((prev) => new Set([...prev, ...newlySeen]));
  }

  function toggleKey(key: string, checked: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function printOne(uniqueKey: string) {
    setPrintOnlyKeys(new Set([uniqueKey]));
    printWithTitle(`ピッキング_${uniqueKey}_${todayStamp()}`);
  }

  function printSelected() {
    if (selectedKeys.size === 0) return;
    setPrintOnlyKeys(new Set(selectedKeys));
    printWithTitle(`ピッキング_${todayStamp()}`);
  }

  return {
    selectionMode,
    setSelectionMode,
    selectedKeys,
    seedDefaults,
    toggleKey,
    printOnlyKeys,
    printOne,
    printSelected,
  };
}

type PickingPrintState = ReturnType<typeof usePickingPrint>;

export function PickingPrintToolbar({
  disabled,
  selectionMode,
  setSelectionMode,
  selectedKeys,
  printSelected,
}: PickingPrintState & { disabled: boolean }) {
  if (!selectionMode) {
    return (
      <Button onClick={() => setSelectionMode(true)} disabled={disabled}>
        <Printer />
        印刷
      </Button>
    );
  }
  return (
    <>
      <span className="text-sm text-muted-foreground">{selectedKeys.size}件選択中</span>
      <Button variant="outline" onClick={() => setSelectionMode(false)}>
        キャンセル
      </Button>
      <Button onClick={printSelected} disabled={selectedKeys.size === 0}>
        <Printer />
        印刷
      </Button>
    </>
  );
}

export default function OrderPickListPanel({ pick }: { pick: PickingPrintState }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightKey = searchParams.get("highlight");
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const { selectionMode, selectedKeys, toggleKey, printOnlyKeys, printOne } = pick;
  const { currentShopId } = useShopContext();
  const { data, isLoading, error } = useQuery({
    queryKey: ["order-summary", currentShopId],
    queryFn: () => fetchOrderSummary(undefined, undefined, currentShopId ?? undefined),
  });

  useEffect(() => {
    if (!data) return;
    pick.seedDefaults(data.orders.map((o) => o.unique_key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const pickFeedback = useSaveFeedback();
  const pickedMutation = useMutation({
    mutationFn: ({ itemId, picked }: { itemId: number; picked: boolean }) =>
      updateOrderItemPicked(itemId, picked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-summary"] });
      // サイドバーの「ピッキング」通知バッジも、ページ遷移を待たずその場で最新化する
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  // リンク経由で特定の注文(?highlight=unique_key)が指定されている場合、その行まで
  // スクロールして一時的にハイライトする(このページは未対応注文のみ・全件表示のため
  // OrderListPageと違いページ番号の計算は不要)
  useEffect(() => {
    if (!data || !highlightKey) return;
    setFlashKey(highlightKey);
    searchParams.delete("highlight");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!flashKey) return;
    document
      .getElementById(`picking-order-${flashKey}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlashKey(null), 2500);
    return () => clearTimeout(timer);
  }, [flashKey]);

  if (isLoading) return <p className="text-sm text-muted-foreground">読み込み中...</p>;
  if (error) {
    return <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>;
  }
  if (!data) return null;

  const ordersForAggregate = printOnlyKeys
    ? data.orders.filter((o) => printOnlyKeys.has(o.unique_key))
    : data.orders;
  const remainingAggregate = computeRemainingAggregate(ordersForAggregate);
  const singleFocusKey =
    printOnlyKeys && printOnlyKeys.size === 1 ? [...printOnlyKeys][0] : null;

  return (
    <div className="grid gap-6 print:gap-3">
      <Card className={cn("min-w-0 print:border print:border-foreground/25", singleFocusKey && "print:hidden")}>
        <CardHeader className="print:hidden">
          <CardTitle>残りの必要数量</CardTitle>
          <CardDescription>
            未対応の注文{formatNumber(data.orders.length)}件のうち、ピッキング未完了分の合計です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {remainingAggregate.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data.orders.length === 0 ? "未対応の注文はありません。" : "全てピッキング済みです。"}
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 print:hidden">
                {remainingAggregate.map((entry) => (
                  <div
                    key={`${entry.component_type}-${entry.id}`}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
                  >
                    <PickEntryLabel entry={entry} />
                    <span className="shrink-0 font-semibold tabular-nums">{formatNumber(entry.quantity)}</span>
                  </div>
                ))}
              </div>
              <PickListPrintTable entries={remainingAggregate} />
            </>
          )}
        </CardContent>
      </Card>

      {data.orders.map((order) => {
        const customerName = [order.last_name, order.first_name].filter(Boolean).join(" ");
        const { picked, total, fullyPicked } = pickingProgress(order);
        // BASE側で商品単位キャンセルされた行はピッキング不要なため、常に非表示にする
        // (切り替え不要。注文全体がキャンセルされた場合は既にこの画面自体に出てこない)
        const pickableItems = order.items.filter((item) => item.status !== "cancelled");
        return (
          <Card
            key={order.id}
            id={`picking-order-${order.unique_key}`}
            className={cn(
              "min-w-0 overflow-hidden transition-colors duration-1000 print:break-inside-avoid print:border print:border-foreground/25 print:[--card-spacing:--spacing(3)] print:[--card-gap:--spacing(2)]",
              order.unique_key === flashKey && "bg-amber-100 dark:bg-amber-500/20",
              fullyPicked &&
                order.unique_key !== flashKey &&
                "border-emerald-300 bg-emerald-50/40 dark:border-emerald-500/50 dark:bg-emerald-500/10",
              printOnlyKeys && !printOnlyKeys.has(order.unique_key) && "print:hidden"
            )}
          >
            <CardHeader className="print:px-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2">
                  {selectionMode && (
                    <Hint label="印刷対象に含める">
                      <input
                        type="checkbox"
                        className="mt-1 size-3.5 accent-primary print:hidden"
                        checked={selectedKeys.has(order.unique_key)}
                        onChange={(e) => toggleKey(order.unique_key, e.target.checked)}
                      />
                    </Hint>
                  )}
                  <div>
                    <CardTitle className="print:text-[9pt]">
                      {customerName || "(氏名未取得)"} 様
                    </CardTitle>
                    <CardDescription className="print:text-[7pt]">
                      注文日 {formatDateTime(order.ordered_at)} ・{" "}
                      <Link
                        to={`/orders?highlight=${encodeURIComponent(order.unique_key)}`}
                        className="font-mono text-primary underline-offset-2 hover:underline"
                      >
                        {order.unique_key}
                      </Link>{" "}
                      <span className="inline-flex align-middle print:hidden">
                        <BaseOrderLinkButton shopId={order.shop_id} uniqueKey={order.unique_key} />
                      </span>
                    </CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-semibold print:px-1.5 print:py-0.5 print:text-[7pt]",
                      fullyPicked
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : picked > 0
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300"
                    )}
                  >
                    {fullyPicked ? "ピッキング完了" : picked > 0 ? `${picked}/${total} 完了` : "未対応"}
                  </span>
                  <Hint label="この注文だけ印刷">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="print:hidden"
                      onClick={() => printOne(order.unique_key)}
                    >
                      <Printer />
                    </Button>
                  </Hint>
                </div>
              </div>
            </CardHeader>
            <CardContent
              className={cn("grid gap-4 print:gap-2 print:px-3", selectionMode && "pl-9")}
            >
              {pickableItems.length === 0 ? (
                <p className="text-sm text-muted-foreground print:text-[7pt]">
                  この注文の商品はすべてキャンセルされています
                </p>
              ) : (
                pickableItems.map((item, i) => (
                <div
                  key={i}
                  className={cn(
                    "grid gap-2 print:gap-1",
                    i > 0 && "border-t pt-4 print:pt-2",
                    item.picked && "opacity-50"
                  )}
                >
                  <div>
                    <label className="flex flex-wrap items-baseline gap-2">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary print:hidden"
                        checked={item.picked}
                        onChange={(e) =>
                          pickedMutation.mutate(
                            { itemId: item.id, picked: e.target.checked },
                            pickFeedback.callbacks(String(item.id))
                          )
                        }
                      />
                      {pickFeedback.errorFor(String(item.id)) && (
                        <Hint label={pickFeedback.errorFor(String(item.id))}>
                          <span className="size-1.5 shrink-0 rounded-full bg-destructive print:hidden" />
                        </Hint>
                      )}
                      <span
                        className={cn(
                          "text-sm font-medium print:text-[8pt] print:font-normal",
                          item.picked && "line-through"
                        )}
                      >
                        {item.title ?? item.item_id}
                      </span>
                      <span className="text-xs text-muted-foreground-subtle print:text-[7pt]">
                        × {formatNumber(item.quantity)}
                      </span>
                    </label>
                    {item.options.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5 print:mt-1 print:gap-1">
                        {item.options.map((opt, oi) => (
                          <span
                            key={oi}
                            className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground-subtle print:px-1.5 print:py-0 print:text-[7pt]"
                          >
                            {opt.option_name}: {opt.option_value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-dashed p-3 print:p-1.5">
                    <div className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground-subtle print:mb-1 print:text-[7pt]">
                      必要な部品・中間品
                    </div>
                    {!item.reservation_applied ? (
                      <p className="text-xs font-medium text-destructive print:text-[7pt] print:font-normal">
                        ⚠️ BOM未設定など、自動引当できていません(次回同期時に再試行されます)
                      </p>
                    ) : item.pick_list.length === 0 ? (
                      <p className="text-xs text-muted-foreground print:text-[7pt]">なし</p>
                    ) : (
                      <>
                        <div className="grid gap-1.5 sm:grid-cols-2 print:hidden">
                          {item.pick_list.map((entry) => (
                            <div
                              key={`${entry.component_type}-${entry.id}`}
                              className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted px-3 py-1.5 text-sm"
                            >
                              <PickEntryLabel entry={entry} />
                              <span className="shrink-0 font-semibold tabular-nums">
                                {formatNumber(entry.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <PickListPrintTable entries={item.pick_list} />
                      </>
                    )}
                  </div>
                </div>
                  ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
