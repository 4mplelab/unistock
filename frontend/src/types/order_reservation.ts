export interface ReservingOrder {
  order_id: number;
  unique_key: string;
  dispatch_status: string;
  ordered_at: string;
  quantity: number;
}
