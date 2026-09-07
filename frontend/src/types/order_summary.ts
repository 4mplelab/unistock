export interface OrderSummaryItemOption {
  option_name: string | null;
  option_value: string | null;
}

export interface PickListEntry {
  component_type: "part" | "assembly";
  id: number;
  name: string;
  quantity: number;
  group: string | null;
  colors: string[] | null;
}

export interface OrderSummaryItem {
  id: number;
  item_id: string;
  title: string | null;
  quantity: number;
  variation: string | null;
  // BASEの注文明細行のstatus("ordered"/"cancelled"等)。商品単位でBASE側だけキャンセル
  // されることがある(注文全体のdispatch_statusとは独立)
  status: string;
  options: OrderSummaryItemOption[];
  reservation_applied: boolean;
  picked: boolean;
  pick_list: PickListEntry[];
  matrix_layout: boolean;
}

export interface OrderSummaryRow {
  id: number;
  shop_id: number;
  unique_key: string;
  ordered_at: string;
  last_name: string | null;
  first_name: string | null;
  prefecture: string | null;
  address: string | null;
  items: OrderSummaryItem[];
  has_unresolved_items: boolean;
}

export interface OrderSummary {
  orders: OrderSummaryRow[];
  aggregate: PickListEntry[];
}
