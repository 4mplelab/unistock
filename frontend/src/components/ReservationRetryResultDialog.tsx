import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { OrderRetryReservationResult } from "../types/order";

// BOM更新の結果(変更前後の差分)を表示する。注文一覧・ピッキング画面の両方から使う共通ダイアログ
export default function ReservationRetryResultDialog({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: OrderRetryReservationResult | null;
}) {
  const diffs = result?.diffs ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>BOMを更新しました</DialogTitle>
          <DialogDescription>
            {diffs.length > 0
              ? "以下の部品・中間品の引当数量が変わりました。在庫は変更していません。"
              : "変更はありませんでした。"}
          </DialogDescription>
        </DialogHeader>
        {diffs.length > 0 && (
          <ul className="space-y-1.5">
            {diffs.map((d) => (
              <li
                key={`${d.component_type}-${d.component_id}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">{d.component_name ?? `#${d.component_id}`}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground-subtle">
                  {formatNumber(d.before)} <span className="text-foreground">→ {formatNumber(d.after)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
