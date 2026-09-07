import type { KeyboardEvent } from "react";

// テキストフィールドにフォーカス中にEnterを押すと、ブラウザの暗黙的送信によって
// (送信ボタンがform=""属性で紐付いているだけで<form>の外にあっても)フォームが
// 送信されてしまう。複数フィールドを順に入力している途中の事故送信を防ぐため、
// textarea(改行入力として使う)以外ではEnterのデフォルト動作を止める
export function preventEnterSubmit(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
    e.preventDefault();
  }
}
