import type { EventLogCategory, EventLogLevel } from "@/types/event_log";

export const EVENT_LOG_LEVEL_LABEL: Record<EventLogLevel, string> = {
  info: "情報",
  warning: "警告",
  error: "エラー",
};

// errorは、サイドバー通知バッジの「critical」トーン(bg-destructive、イベントログの
// エラー件数バッジ)と同じ標準色(destructive)に揃えている
export const EVENT_LOG_LEVEL_CLASS: Record<EventLogLevel, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  error: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive",
};

export const EVENT_LOG_CATEGORY_LABEL: Record<EventLogCategory, string> = {
  reservation_skipped: "引当スキップ",
  assembly_stock_shortfall: "中間品在庫不足",
  stock_operation_failed: "在庫操作失敗",
  retention_cleanup: "自動データ削除",
  auth_error: "認証エラー",
};
