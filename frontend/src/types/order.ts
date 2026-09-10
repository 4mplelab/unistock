export type DispatchStatus = "unshippable" | "ordered" | "unpaid" | "shipping" | "dispatched" | "cancelled";

export interface OrderItemOption {
  option_name: string | null;
  option_value: string | null;
}

export interface OrderItem {
  id: number;
  item_id: string;
  title: string | null;
  quantity: number;
  price: number | null;
  variation: string | null;
  // BASEの注文明細行のstatus("ordered"/"cancelled"等)。商品単位でBASE側だけキャンセル
  // されることがある(注文全体のdispatch_statusとは独立)
  status: string;
  picked: boolean;
  options: OrderItemOption[];
}

export interface Order {
  id: number;
  shop_id: number;
  platform: string;
  unique_key: string;
  dispatch_status: DispatchStatus | string;
  ordered_at: string;
  dispatched_at: string | null;
  cancelled_at: string | null;
  modified_at: string | null;
  // BASEの注文合計金額(送料・代引き手数料・割引を含み、キャンセル済み商品は除外済み)。
  // 発送確定済みで以後取得し直されない古い注文はnullのまま
  total_amount: number | null;
  last_name: string | null;
  first_name: string | null;
  prefecture: string | null;
  address: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

export interface OrderListResult {
  items: Order[];
  total: number;
  page: number;
}

export interface IngestionResult {
  orders_seen: number;
  new_orders: number;
  transitioned_orders: number;
  errors: string[];
}

export interface ReservationDiffEntry {
  component_type: "part" | "assembly";
  component_id: number;
  component_name: string | null;
  before: number;
  after: number;
}

export interface OrderRetryReservationResult {
  order: Order;
  diffs: ReservationDiffEntry[];
}
