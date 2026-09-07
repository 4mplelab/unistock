export function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}

/** 在庫変動履歴のような、増減(±)を伴う数量の表示用。マイナスは`toLocaleString`が
 * 自動で「-」を付けるので、プラスの符号だけここで付与する */
export function formatSignedNumber(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}
