export interface SalesSummaryPoint {
  date: string;
  revenue: number;
  cost: number;
  gross_profit: number;
  order_count: number;
}

export interface SalesSummaryProductRow {
  item_id: string;
  title: string | null;
  quantity: number;
  revenue: number;
  cost: number;
  gross_profit: number;
  gross_margin_rate: number;
}

export interface SalesSummaryCategoryProductRow {
  item_id: string;
  title: string | null;
  quantity: number;
  revenue: number;
}

export interface SalesSummaryCategoryRow {
  category_id: number | null;
  name: string;
  quantity: number;
  revenue: number;
  products: SalesSummaryCategoryProductRow[];
}

export interface SalesSummary {
  days: number;
  total_revenue: number;
  total_quantity: number;
  total_cost: number;
  total_gross_profit: number;
  gross_margin_rate: number;
  order_count: number;
  average_order_value: number;
  points: SalesSummaryPoint[];
  products: SalesSummaryProductRow[];
  categories: SalesSummaryCategoryRow[];
}
