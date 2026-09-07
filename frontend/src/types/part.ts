export interface Part {
  id: number;
  name: string;
  sku: string | null;
  stock: number;
  reserved: number;
  unit_cost: number | null;
  tags: string[] | null;
  group: string | null;
  colors: string[] | null;
  purchase_url: string | null;
  reorder_threshold: number | null;
  purchasable: boolean;
  memo: string | null;
  available: number;
  ordered_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface PartCreateInput {
  name: string;
  sku?: string | null;
  stock: number;
  unit_cost?: number | null;
  tags?: string[] | null;
  group?: string | null;
  colors?: string[] | null;
  purchase_url?: string | null;
  reorder_threshold?: number | null;
  purchasable?: boolean;
  memo?: string | null;
  // 在庫数を直接変更した場合、在庫変動履歴(reason=manual_edit)に記録するメモ
  note?: string | null;
}

export interface PartUpdateInput {
  name?: string;
  sku?: string | null;
  stock?: number;
  unit_cost?: number | null;
  tags?: string[] | null;
  group?: string | null;
  colors?: string[] | null;
  purchase_url?: string | null;
  reorder_threshold?: number | null;
  purchasable?: boolean;
  memo?: string | null;
  // 在庫数を直接変更した場合、在庫変動履歴(reason=manual_edit)に記録するメモ
  note?: string | null;
}

export interface PartImportResult {
  created: number;
  updated: number;
  errors: string[];
}
