export interface ManualItemVariation {
  id: number;
  name: string;
  // このバリエーション自体の価格(円)。未入力(null)なら商品本体の価格を使う
  price: number | null;
  stock: number;
  sort_order: number;
}

export interface ManualItem {
  shop_id: number;
  item_id: string;
  title: string;
  price: number | null;
  stock: number;
  description: string | null;
  created_at: string;
  variations: ManualItemVariation[];
}

export interface ManualItemVariationInput {
  name: string;
  price?: number | null;
  stock: number;
  sort_order?: number;
}

export interface ManualItemCreateInput {
  item_id: string;
  title: string;
  price: number | null;
  stock: number;
  description?: string | null;
  variations?: ManualItemVariationInput[];
}

export interface ManualItemVariationUpsertInput {
  id?: number;
  name: string;
  price?: number | null;
  stock: number;
  sort_order?: number;
}

export interface ManualItemUpdateInput {
  title?: string;
  price?: number | null;
  stock?: number;
  description?: string | null;
  variations?: ManualItemVariationUpsertInput[];
}

export interface ManualItemConsumeInput {
  quantity: number;
  variation_id?: number | null;
  note?: string | null;
}

export interface ManualOrderItemInput {
  item_id: string;
  quantity: number;
  variation_id?: number | null;
  price?: number | null;
}

export interface ManualOrderCreateInput {
  ordered_at?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  prefecture?: string | null;
  address?: string | null;
  email?: string | null;
  items: ManualOrderItemInput[];
}

export interface ManualOrderImportResult {
  created: number;
  errors: string[];
}

export interface ManualOrderCsvPreview {
  columns: string[];
  sample_rows: Record<string, string>[];
}

export interface ManualOrderCsvColumnMapping {
  order_ref?: string | null;
  ordered_at?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  prefecture?: string | null;
  address?: string | null;
  email?: string | null;
  item_id: string;
  quantity?: string | null;
  variation_name?: string | null;
  price?: string | null;
}

export interface ManualOrderImportProfile {
  id: number;
  name: string;
  mapping: ManualOrderCsvColumnMapping;
  created_at: string;
}

export interface ManualOrderImportProfileCreateInput {
  name: string;
  mapping: ManualOrderCsvColumnMapping;
}
