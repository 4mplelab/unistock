export type ScheduleStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface StockSchedule {
  id: number;
  shop_id: number;
  platform: string;
  item_id: string;
  item_name: string | null;
  target_stock: number;
  run_at: string;
  status: ScheduleStatus;
  result_message: string | null;
  http_status: number | null;
  executed_at: string | null;
  created_at: string;
}

export interface StockScheduleListResult {
  items: StockSchedule[];
  total: number;
}

export interface StockScheduleCreateInput {
  shop_id: number;
  item_id: string;
  item_name?: string;
  target_stock: number;
  run_at: string;
}

export interface StockScheduleUpdateInput {
  target_stock: number;
  run_at: string;
}
