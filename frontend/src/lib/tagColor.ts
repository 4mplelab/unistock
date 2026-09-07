// dataviz skillの検証済みカテゴリカルパレット(8色、light/dark)をそのまま流用する。
// タグは自由入力の無制限集合のため、文字列ハッシュで決定的に8スロットへ割り当てる
// (同じタグ文字列は常に同じ色になる。8種を超えると色が重複するが、
// バッジ自体に常にテキストラベルが付くため色のみに意味を持たせているわけではない)
// GroupChip(部品のグループ表示)はグレー(bg-secondary)を使っているため、
// 今後この配列に色を追加する場合もグレー系(低彩度)は避けること

const CATEGORICAL_PALETTE: { light: string; dark: string }[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

export function tagColor(tag: string): { light: string; dark: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % CATEGORICAL_PALETTE.length;
  return CATEGORICAL_PALETTE[index];
}
