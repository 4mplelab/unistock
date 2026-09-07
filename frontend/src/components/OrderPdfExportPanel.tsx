import { useState } from "react";
import { Printer } from "lucide-react";
import { fetchOrderSummary } from "../api/client";
import type { OrderSummary, OrderSummaryItem, OrderSummaryRow } from "../types/order_summary";
import { Button } from "@/components/ui/button";
import PickListPrintTable from "@/components/PickListPrintTable";
import { printWithTitle, todayStamp } from "@/lib/printWithTitle";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

// 印刷対象の選択(注文一覧のチェックボックス)・取得・印刷実行までをまとめて管理するフック。
// 印刷専用コンテンツ(hidden print:block)が印刷時に隠れてしまわないよう、呼び出し側は
// ツールバー(<OrderPdfExportToolbar>、他のprint:hiddenなボタン類と同じ行に置いてよい)と
// 印刷専用コンテンツ(<OrderPdfExportContent>、必ずprint:hiddenな祖先の外に置く)を
// 別々の場所にレンダリングする
export function useOrderPdfExport() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [seenKeys, setSeenKeys] = useState<Set<string>>(new Set());
  const [includePicking, setIncludePicking] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [data, setData] = useState<OrderSummary | undefined>();

  // 注文一覧のページが読み込まれる(ページ送り含む)たびに呼ぶ。まだ見ていない注文だけ
  // 未対応ならデフォルトでチェックを入れる。ユーザーが手動でチェック/解除した状態は
  // 上書きしない
  function seedDefaults(orders: { unique_key: string; dispatch_status: string }[]) {
    const newlySeen = orders.filter((o) => !seenKeys.has(o.unique_key));
    if (newlySeen.length === 0) return;
    setSeenKeys((prev) => {
      const next = new Set(prev);
      newlySeen.forEach((o) => next.add(o.unique_key));
      return next;
    });
    const toCheck = newlySeen.filter((o) => o.dispatch_status === "ordered").map((o) => o.unique_key);
    if (toCheck.length > 0) {
      setSelectedKeys((prev) => new Set([...prev, ...toCheck]));
    }
  }

  function toggleKey(key: string, checked: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  // 「キャンセル済み注文を表示」を切り替えると選択可能な行の集合が変わるため、
  // 選択状態を持ち越さずリセットする(非表示にした注文が選択に残ったまま印刷されるのを防ぐ)
  function resetSelection() {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }

  async function handlePrint() {
    if (selectedKeys.size === 0) return;
    setIsFetching(true);
    try {
      const result = await fetchOrderSummary(undefined, [...selectedKeys]);
      setData(result);
      printWithTitle(`注文一覧_${todayStamp()}`);
    } finally {
      setIsFetching(false);
    }
  }

  return {
    selectionMode,
    setSelectionMode,
    selectedKeys,
    seedDefaults,
    toggleKey,
    resetSelection,
    includePicking,
    setIncludePicking,
    isFetching,
    handlePrint,
    data,
  };
}

type PdfExportState = ReturnType<typeof useOrderPdfExport>;

export function OrderPdfExportToolbar({
  totalCount,
  selectionMode,
  setSelectionMode,
  selectedKeys,
  includePicking,
  setIncludePicking,
  isFetching,
  handlePrint,
}: PdfExportState & { totalCount: number }) {
  if (!selectionMode) {
    return (
      <Button onClick={() => setSelectionMode(true)} disabled={totalCount === 0}>
        <Printer />
        印刷
      </Button>
    );
  }
  return (
    <>
      <span className="text-sm text-muted-foreground">{selectedKeys.size}件選択中</span>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={includePicking}
          onChange={(e) => setIncludePicking(e.target.checked)}
        />
        ピッキング内容も含める
      </label>
      <Button variant="outline" onClick={() => setSelectionMode(false)}>
        キャンセル
      </Button>
      <Button onClick={handlePrint} disabled={isFetching || selectedKeys.size === 0}>
        {isFetching ? "作成中..." : "印刷"}
      </Button>
    </>
  );
}

interface MatrixGroup {
  itemId: string;
  title: string;
  columns: string[];
  rows: {
    uniqueKey: string;
    customerName: string;
    address: string;
    quantity: number;
    cancelled: boolean;
    optionByName: Map<string, string>;
  }[];
}

function isMatrixItem(item: OrderSummaryItem): boolean {
  return item.matrix_layout;
}

// matrix_layout=trueの商品をitem_idごとにグルーピングし、それぞれ独立した表(商品ごとに
// オプション構成が違うため列も別々)にする
function buildMatrixGroups(orders: OrderSummaryRow[]): MatrixGroup[] {
  const groups = new Map<string, MatrixGroup>();
  for (const order of orders) {
    const customerName = [order.last_name, order.first_name].filter(Boolean).join(" ") || "(氏名未取得)";
    // 画面(注文一覧)の表示に合わせ、都道府県+住所をそのまま連結する
    const address = `${order.prefecture ?? ""}${order.address ?? ""}`;
    for (const item of order.items) {
      if (!isMatrixItem(item)) continue;
      let group = groups.get(item.item_id);
      if (!group) {
        group = { itemId: item.item_id, title: item.title ?? item.item_id, columns: [], rows: [] };
        groups.set(item.item_id, group);
      }
      const optionByName = new Map<string, string>();
      for (const opt of item.options) {
        const name = opt.option_name ?? "";
        if (!name) continue;
        if (!group.columns.includes(name)) group.columns.push(name);
        optionByName.set(name, opt.option_value ?? "");
      }
      group.rows.push({
        uniqueKey: order.unique_key,
        customerName,
        address,
        quantity: item.quantity,
        cancelled: item.status === "cancelled",
        optionByName,
      });
    }
  }
  return Array.from(groups.values());
}

export function OrderPdfExportContent({
  data,
  includePicking,
  showCancelledItems,
}: {
  data: OrderSummary | undefined;
  includePicking: boolean;
  showCancelledItems: boolean;
}) {
  if (!data) return null;

  // 注文一覧の「キャンセル済み商品を表示」設定を印刷にもそのまま反映する
  const visibleOrders = showCancelledItems
    ? data.orders
    : data.orders.map((order) => ({
        ...order,
        items: order.items.filter((i) => i.status !== "cancelled"),
      }));

  const matrixGroups = buildMatrixGroups(visibleOrders);
  // 横並び表(matrixGroups)は選択肢を列として比較しやすくする代わりに、必要な部品・
  // 中間品までは入れられない(商品ごとに列構成が違うため)。「ピッキング内容も含める」を
  // 有効にした場合は、表とは別にこのカード形式で商品ごとの必要数を補足する
  const matrixPickingRows = includePicking
    ? visibleOrders.flatMap((order) => {
        const customerName = [order.last_name, order.first_name].filter(Boolean).join(" ") || "(氏名未取得)";
        return order.items
          .filter((item) => isMatrixItem(item) && item.status !== "cancelled")
          .map((item) => ({ order, item, customerName }));
      })
    : [];
  const otherOrders = visibleOrders
    .map((order) => ({
      order,
      items: order.items.filter((i) => !isMatrixItem(i)),
      matrixItems: order.items.filter(isMatrixItem),
    }))
    .filter(({ items }) => items.length > 0);
  // 上表(横並び)の商品と、下のカード形式の商品が同一注文に同梱されている場合、
  // 見ただけでは同じ注文と分からないため、上表の行に「他の商品も同梱」の注記を出す
  const ordersWithOtherItems = new Set(
    visibleOrders.filter((o) => o.items.some((i) => !isMatrixItem(i))).map((o) => o.unique_key)
  );

  return (
    <div className="hidden print:block">
      <h1 className="text-[11pt] font-semibold">注文一覧({data.orders.length}件)</h1>

      {matrixGroups.map((group) => (
        <table key={group.itemId} className="mt-4 w-full border-collapse text-[7pt]">
          <caption className="mb-1 text-left text-[8pt] font-semibold">{group.title}</caption>
          <thead>
            <tr>
              <th className="border-b border-foreground/40 py-1 pr-4 text-left font-semibold">注文ID</th>
              <th className="min-w-[65pt] border-b border-foreground/40 py-1 pr-4 text-left font-semibold">
                お客様
              </th>
              <th className="border-b border-foreground/40 py-1 pr-4 text-right font-semibold">数量</th>
              {group.columns.map((name) => (
                <th key={name} className="border-b border-foreground/40 py-1 pr-4 text-left font-semibold">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, i) => (
              <tr key={i} className={row.cancelled ? "opacity-50" : undefined}>
                <td
                  className={cn(
                    "border-b border-foreground/15 py-1 pr-4 font-mono",
                    row.cancelled && "line-through"
                  )}
                >
                  {row.uniqueKey}
                  {row.cancelled && (
                    <span className="force-print-color ml-1.5 rounded bg-gray-200 px-1 py-0.5 font-sans text-[6pt] font-normal no-underline">
                      キャンセル
                    </span>
                  )}
                  {ordersWithOtherItems.has(row.uniqueKey) && (
                    <div className="mt-0.5">
                      <span className="force-print-color rounded bg-foreground px-1 py-0.5 font-sans text-[6pt] font-normal text-background">
                        他商品あり
                      </span>
                    </div>
                  )}
                </td>
                <td className="border-b border-foreground/15 py-1 pr-4">
                  <div>{row.customerName}</div>
                  {row.address && (
                    <div className="text-[6pt] text-muted-foreground-subtle">{row.address}</div>
                  )}
                </td>
                <td className="border-b border-foreground/15 py-1 pr-4 text-right tabular-nums">
                  {formatNumber(row.quantity)}
                </td>
                {group.columns.map((name) => (
                  <td key={name} className="border-b border-foreground/15 py-1 pr-4">
                    {row.optionByName.get(name) ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {matrixPickingRows.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4">
          {matrixPickingRows.map(({ order, item, customerName }, i) => (
            <div
              key={`${order.unique_key}-${item.id}-${i}`}
              className="min-w-0 break-inside-avoid overflow-hidden rounded-lg border p-3 text-[7pt]"
            >
              <div className="flex flex-wrap items-center gap-1.5 break-words text-[8pt] font-semibold">
                {customerName} 様 ・ <span className="font-mono">{order.unique_key}</span>
              </div>
              <div className="mt-2">
                <div>
                  {item.title ?? item.item_id} × {formatNumber(item.quantity)}
                </div>
                {item.options.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {item.options.map((opt, oi) => (
                      <span key={oi} className="force-print-color rounded-md bg-gray-200 px-2 py-0.5 text-[6pt]">
                        {opt.option_name}: {opt.option_value}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 rounded-lg border border-dashed p-3">
                  <div className="mb-2 text-[6pt] font-semibold tracking-wide text-muted-foreground-subtle">
                    必要な部品・中間品
                  </div>
                  {!item.reservation_applied ? (
                    <p className="text-[6pt] font-medium text-destructive">
                      ⚠️ BOM未設定など、自動引当できていません
                    </p>
                  ) : item.pick_list.length === 0 ? (
                    <p className="text-[6pt] text-muted-foreground">なし</p>
                  ) : (
                    <PickListPrintTable entries={item.pick_list} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {otherOrders.length > 0 && (
        <div className={cn("mt-6 grid gap-4", includePicking ? "grid-cols-1" : "grid-cols-3")}>
          {otherOrders.map(({ order, items, matrixItems }) => {
            const customerName =
              [order.last_name, order.first_name].filter(Boolean).join(" ") || "(氏名未取得)";
            return (
              <div
                key={order.id}
                className="min-w-0 break-inside-avoid overflow-hidden rounded-lg border p-3 text-[7pt]"
              >
                <div className="flex flex-wrap items-center gap-1.5 break-words text-[8pt] font-semibold">
                  {customerName} 様 ・ <span className="font-mono">{order.unique_key}</span>
                  {matrixItems.length > 0 && (
                    <span className="force-print-color rounded bg-foreground px-1 py-0.5 font-sans text-[6pt] font-normal text-background">
                      他商品あり
                    </span>
                  )}
                </div>
                <div className="mt-2 grid gap-3">
                  {items.map((item, i) => {
                    const cancelled = item.status === "cancelled";
                    return (
                    <div key={i} className={i > 0 ? "border-t pt-3" : ""}>
                      <div className={cancelled ? "opacity-50 line-through" : ""}>
                        {item.title ?? item.item_id} × {formatNumber(item.quantity)}
                        {cancelled && (
                          <span className="force-print-color ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-[6pt] font-normal no-underline">
                            キャンセル
                          </span>
                        )}
                      </div>
                      {item.options.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {item.options.map((opt, oi) => (
                            <span key={oi} className="force-print-color rounded-md bg-gray-200 px-2 py-0.5 text-[6pt]">
                              {opt.option_name}: {opt.option_value}
                            </span>
                          ))}
                        </div>
                      )}
                      {includePicking && !cancelled && (
                        <div className="mt-2 rounded-lg border border-dashed p-3">
                          <div className="mb-2 text-[6pt] font-semibold tracking-wide text-muted-foreground-subtle">
                            必要な部品・中間品
                          </div>
                          {!item.reservation_applied ? (
                            <p className="text-[6pt] font-medium text-destructive">
                              ⚠️ BOM未設定など、自動引当できていません
                            </p>
                          ) : item.pick_list.length === 0 ? (
                            <p className="text-[6pt] text-muted-foreground">なし</p>
                          ) : (
                            <PickListPrintTable entries={item.pick_list} />
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {matrixGroups.length === 0 && otherOrders.length === 0 && (
        <p className="mt-4 text-[7pt] text-muted-foreground">対象の注文はありません。</p>
      )}
    </div>
  );
}
