export type PurchaseOrderStatus = "ordered" | "received" | "cancelled";

export interface PurchaseOrder {
  id: number;
  part_id: number;
  shop_id: number;
  part_name: string;
  quantity: number;
  status: PurchaseOrderStatus | string;
  ordered_at: string;
  received_at: string | null;
  expected_delivery_date: string | null;
  note: string | null;
  order_url: string | null;
  created_at: string;
}

export interface PurchaseOrderListResult {
  items: PurchaseOrder[];
  total: number;
  page: number;
}

export interface PurchaseOrderCreateInput {
  part_id: number;
  shop_id: number;
  quantity: number;
  note?: string | null;
  expected_delivery_date?: string | null;
  order_url?: string | null;
}

export interface ReorderNeeded {
  id: number;
  name: string;
  sku: string | null;
  stock: number;
  reserved: number;
  available: number;
  reorder_threshold: number;
  purchase_url: string | null;
  has_open_order: boolean;
}

export interface LeadTimeSummary {
  lead_times_days: number[];
}
