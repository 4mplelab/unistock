import { useQuery } from "@tanstack/react-query";
import { fetchSettings } from "@/api/client";

export interface PartColorDef {
  name: string;
  hex: string;
}

export const PART_COLORS_SETTING_KEY = "part_colors";

// 初回起動時の初期値。設定画面(カラーパレット管理)からビルド不要で追加・編集・削除できる。
// 部品の実物の色を表すため、タグの自動ハッシュ色とは異なり手動で実物に忠実な色を定義する
export const DEFAULT_PART_COLORS: PartColorDef[] = [
  { name: "ブラック", hex: "#1a1a1a" },
  { name: "ホワイト", hex: "#f2f2ee" },
  { name: "ライトグレー", hex: "#b8b8b8" },
  { name: "グレー", hex: "#7a7a7a" },
  { name: "ネイビー", hex: "#1f2a44" },
  { name: "ゴールド", hex: "#c9a227" },
  { name: "シルバー", hex: "#c0c0c0" },
  { name: "レッド", hex: "#c0392b" },
  { name: "ベージュ", hex: "#d9c8a9" },
  { name: "クリア", hex: "#dceaf0" },
];

/** 設定(part_colors)に保存されたJSON文字列をパースする。未設定・壊れている場合は初期値にフォールバックする */
export function parsePartColors(raw: string | undefined | null): PartColorDef[] {
  if (!raw) return DEFAULT_PART_COLORS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((c) => typeof c?.name === "string" && typeof c?.hex === "string")) {
      return parsed;
    }
  } catch {
    // 壊れたJSONは初期値にフォールバック
  }
  return DEFAULT_PART_COLORS;
}

/** 未知の色名(表記ゆれ・旧データ等)は薄いグレーのスウォッチにフォールバックする */
export function partColorHex(name: string, colors: PartColorDef[]): string {
  return colors.find((c) => c.name === name)?.hex ?? "#9ca3af";
}

/** 設定(カラーパレット管理)で管理されているカラーパレットを取得する。
 * 設定ページ・部品フォーム・部品一覧など、パレットを参照する箇所で共通して使う */
export function usePartColors(): PartColorDef[] {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const raw = data?.find((s) => s.key === PART_COLORS_SETTING_KEY)?.value;
  return parsePartColors(raw);
}
