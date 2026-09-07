// BOMの構成要素種別。"none"は「意図的に部品不要」を明示するマーカー
// (中間品のレシピ(AssemblyItem)にはこの概念は無いため、MaterialTypeとは別に定義する)
export type BomComponentType = "part" | "assembly" | "none";

export interface BomCondition {
  selector_type: "option" | "variation";
  selector_id: string;
  group_name: string | null;
  choice_name: string | null;
  group_order: number | null;
  choice_order: number | null;
}

export interface BomItem {
  id: number;
  item_id: string;
  item_name: string | null;
  component_type: BomComponentType;
  part_id: number | null;
  assembly_id: number | null;
  component_name: string;
  quantity: number;
  conditions: BomCondition[];
  created_at: string;
  updated_at: string;
}

export interface BomListResult {
  items: BomItem[];
  total: number;
}

export interface BomReplaceLine {
  component_type: BomComponentType;
  part_id?: number | null;
  assembly_id?: number | null;
  quantity: number;
  conditions?: BomCondition[];
}

export interface BomReplaceInput {
  item_name?: string | null;
  lines: BomReplaceLine[];
}

export interface BomImportResult {
  created: number;
  updated: number;
  errors: string[];
}

export interface BomProductSetting {
  item_id: string;
  matrix_layout: boolean;
  buildable_alert_threshold: number | null;
}
