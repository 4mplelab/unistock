import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DispatchStatus } from "../types/order";

export const STATUS_LABEL: Record<string, string> = {
  unshippable: "対応開始前",
  ordered: "未対応",
  unpaid: "入金待ち",
  shipping: "配送中",
  dispatched: "対応済",
  cancelled: "キャンセル",
};

export const STATUS_CLASS: Record<string, string> = {
  // ordered/unpaidは、アプリ全体で「保留・注意」を表す標準色(amber、発注管理の
  // 「発注中」・イベントログの警告レベル等と同系統)に揃えている。cancelledも同様に、
  // アプリ全体の「エラー・キャンセル」の標準色(destructive)に揃えている
  unshippable: "bg-muted text-muted-foreground",
  ordered: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  unpaid: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  shipping: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  dispatched: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  cancelled: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive",
};

export default function OrderStatusBadge({ status }: { status: DispatchStatus | string }) {
  return (
    <Badge className={cn("border-transparent", STATUS_CLASS[status])}>{STATUS_LABEL[status] ?? status}</Badge>
  );
}
