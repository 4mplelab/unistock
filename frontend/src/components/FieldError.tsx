/** 保存/送信失敗時のインライン赤文字。フィールドやボタンのすぐ近くに置く。
 * messageがnullなら何も表示しない(直すまで表示し続けたいので自動では消えない) */
export default function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
