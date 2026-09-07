// ブラウザの「PDFに保存」はdocument.titleを既定のファイル名として提案する。
// 印刷直前だけ一時的にタイトルを差し替え、印刷ダイアログを閉じたら元に戻す
export function printWithTitle(filename: string) {
  const original = document.title;
  document.title = filename;

  function restore() {
    document.title = original;
    window.removeEventListener("afterprint", restore);
  }
  window.addEventListener("afterprint", restore);

  requestAnimationFrame(() => window.print());
}

export function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
