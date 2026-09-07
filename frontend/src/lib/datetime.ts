const pad = (n: number) => String(n).padStart(2, "0");

/** `<input type="datetime-local">`用の値に変換する。valueを省略すると現在日時になる */
export function toDatetimeLocalInput(value?: string | Date): string {
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// `toLocaleString("ja-JP")`は月・日・時・分を0埋めしない(例: "2026/8/1 9:05:00")ため、
// 一覧で日付が縦に並ぶと桁数が揃わず読みにくい。0埋めした固定幅の表示に統一する
export function formatDateTime(value: string | Date): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDate(value: string | Date): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}
