import { useEffect } from "react";

// 編集不可能なinput(checkbox等)を含め、テキスト編集中でない要素にフォーカスがある
// 状態でBackspaceを押すとブラウザ標準の「戻る」操作が発火してしまう(SPAではURLが
// 変わらない画面遷移が多く事故になりやすい)。テキスト編集中の場合だけ素通しし、
// それ以外はBackspaceのデフォルト動作(=戻る)を止める
const EDITABLE_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "password",
  "tel",
  "url",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  if (target instanceof HTMLInputElement) {
    return !target.disabled && !target.readOnly && EDITABLE_INPUT_TYPES.has(target.type);
  }
  return false;
}

export function useBackspaceNavigationGuard() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Backspace") return;
      if (!isEditableTarget(e.target)) {
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
