// 一覧画面の表示トグル(Switch)の状態をlocalStorageに保存し、ページ遷移後も選択を
// 保持するための小さなヘルパー。読み書き失敗(プライベートモード等)は握りつぶし、
// 呼び出し側にはdefaultValueを返すだけにする
export function readStoredToggle(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? defaultValue : raw === "true";
  } catch {
    return defaultValue;
  }
}

export function writeStoredToggle(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorageが使えない環境では保存をスキップする
  }
}
