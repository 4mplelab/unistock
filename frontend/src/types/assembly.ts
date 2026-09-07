import type { BomCondition } from "./bom";

export interface Assembly {
  id: number;
  name: string;
  sku: string | null;
  stock: number;
  reserved: number;
  unit_cost: number | null;
  tags: string[] | null;
  group: string | null;
  memo: string | null;
  available: number;
  created_at: string;
  updated_at: string;
}

export interface AssemblyCreateInput {
  name: string;
  sku?: string | null;
  stock: number;
  unit_cost?: number | null;
  tags?: string[] | null;
  group?: string | null;
  memo?: string | null;
  // 編集画面のフォームがcreate/updateで共用のため定義しているが、新規作成時は送信しない
  note?: string | null;
  // 中間品の作成と組成(レシピ)登録を1リクエスト・1トランザクションでまとめて行う
  recipe?: AssemblyItemInput[];
}

export interface AssemblyUpdateInput {
  name?: string;
  sku?: string | null;
  stock?: number;
  unit_cost?: number | null;
  tags?: string[] | null;
  group?: string | null;
  memo?: string | null;
  // stockを直接変更した場合、組立履歴(kind=adjustment)に記録するメモ
  note?: string | null;
  // 指定時のみ組成(レシピ)を丸ごと置き換える。基本情報の更新と1リクエスト・1トランザクションでまとめて行う
  recipe?: AssemblyItemInput[];
}

export interface AssemblyImportResult {
  created: number;
  updated: number;
  errors: string[];
}

export type MaterialType = "part" | "assembly";

export interface AssemblyItem {
  id: number;
  material_type: MaterialType;
  material_id: number;
  material_name: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface AssemblyItemInput {
  material_type: MaterialType;
  material_id: number;
  quantity: number;
}

export interface AssemblyBuildInput {
  quantity: number;
  note?: string | null;
}

export interface AssemblyBomUsage {
  bom_item_id: number;
  shop_id: number;
  item_id: string;
  item_name: string | null;
  quantity: number;
  conditions: BomCondition[];
}

export interface AssemblyRecipeUsage {
  assembly_item_id: number;
  assembly_id: number;
  assembly_name: string;
  quantity: number;
}

export interface AssemblyUsages {
  bom_items: AssemblyBomUsage[];
  assembly_items: AssemblyRecipeUsage[];
}
