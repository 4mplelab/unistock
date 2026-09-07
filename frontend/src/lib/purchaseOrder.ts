function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysElapsed(orderedAt: string): number {
  const orderedDateString = orderedAt.slice(0, 10);
  const diffMs = new Date(todayDateString()).getTime() - new Date(orderedDateString).getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

// expected_delivery_date・ordered_atはどちらも「日付のみ」の文字列比較で判定する。
// Dateオブジェクトの日付のみ文字列("YYYY-MM-DD")はUTC 0時としてパースされるため、
// ブラウザのローカルタイムゾーンがUTCより遅れている場合、ローカルの「今日」の午前0時が
// UTC 0時より後になり、"今日が納期"のケースを誤って「納期超過」と判定してしまう
// (実機で確認済みの不具合)。日付文字列同士の比較ならこの食い違いが起きない。
export function isOverdue(expectedDeliveryDate: string | null): boolean {
  if (!expectedDeliveryDate) return false;
  return expectedDeliveryDate.slice(0, 10) < todayDateString();
}
