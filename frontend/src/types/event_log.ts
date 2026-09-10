export type EventLogCategory =
  | "reservation_skipped"
  | "assembly_stock_shortfall"
  | "stock_operation_failed"
  | "retention_cleanup"
  | "auth_error";
export type EventLogLevel = "info" | "warning" | "error";

export interface EventLog {
  id: number;
  category: EventLogCategory;
  level: EventLogLevel;
  message: string;
  order_id: number | null;
  order_unique_key: string | null;
  item_id: string | null;
  shop_id: number | null;
  created_at: string;
  // 同一(category, order_id, item_id)が繰り返し発生した回数。集約対象外のカテゴリは常に1
  occurrence_count: number;
  last_occurred_at: string;
}

export interface EventLogListResult {
  items: EventLog[];
  total: number;
  page: number;
}
