export type StockMovementReason =
  | "manual_edit"
  | "add_stock"
  | "purchase_order_received"
  | "purchase_order_receive_undone"
  | "order_consumed"
  | "order_dispatch_undone"
  | "assembly_build"
  | "assembly_build_material"
  | "manual_item_consumed";

export type StockMovementComponentType = "part" | "assembly";

export interface StockMovement {
  id: number;
  component_type: StockMovementComponentType;
  component_id: number;
  component_name: string;
  quantity: number;
  reason: StockMovementReason;
  note: string | null;
  order_id: number | null;
  order_unique_key: string | null;
  purchase_order_id: number | null;
  shop_id: number | null;
  created_at: string;
}

export interface StockMovementListResult {
  items: StockMovement[];
  total: number;
}

export interface StockMovementFilters {
  component_type?: StockMovementComponentType;
  part_id?: number;
  assembly_id?: number;
  reason?: StockMovementReason;
  order_unique_key?: string;
  date_from?: string;
  date_to?: string;
  shop_id?: number;
  include_shared?: boolean;
}

export interface ConsumptionSummaryPoint {
  date: string;
  quantity: number;
}

export interface ConsumptionSummarySeries {
  component_type: StockMovementComponentType;
  component_id: number;
  component_name: string;
  total: number;
  points: ConsumptionSummaryPoint[];
}

export interface ConsumptionSummary {
  days: number;
  series: ConsumptionSummarySeries[];
}

export interface AssemblyBuildSummaryPoint {
  date: string;
  quantity: number;
}

export interface AssemblyBuildSummary {
  days: number;
  points: AssemblyBuildSummaryPoint[];
}
