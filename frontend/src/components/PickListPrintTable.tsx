import type { PickListEntry } from "../types/order_summary";
import { formatNumber } from "@/lib/format";

// 印刷時は色スウォッチ(丸)や色付きの部品名ではなく、罫線区切りのプレーンな行で出力する
// (紙面上ではドットの色や画面のホバーツールチップが失われるため、色は文字で書き出す)。
// 画面の一覧(sm:grid-cols-2)と同じく2列で横に並べ、縦に間延びしないようにする
export default function PickListPrintTable({ entries }: { entries: PickListEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="hidden grid-cols-2 gap-x-6 text-[7pt] print:grid">
      {entries.map((entry) => (
        <div
          key={`${entry.component_type}-${entry.id}`}
          className="flex min-w-0 items-center justify-between gap-2 border-b border-foreground/15 py-1"
        >
          <span className="min-w-0 truncate">
            {entry.name}
            {entry.component_type === "assembly" ? " (中間品)" : ""}
            {entry.group ? ` (${entry.group})` : ""}
            {entry.colors && entry.colors.length > 0 ? ` [${entry.colors.join("・")}]` : ""}
          </span>
          <span className="shrink-0 tabular-nums">{formatNumber(entry.quantity)}</span>
        </div>
      ))}
    </div>
  );
}
