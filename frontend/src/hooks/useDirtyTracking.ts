import { useEffect, useRef } from "react";

/**
 * フォームの初期値セット(初回レンダー)は無視し、以降にvaluesのいずれかが変化したら
 * onDirtyChangeをtrueで呼ぶ。ダーティ状態のリセット(保存成功時など)は呼び出し側が
 * 自前で行う想定で、ここでは一方通行(true化)のみを担う。
 */
export function useDirtyTracking(values: unknown[], onDirtyChange?: (dirty: boolean) => void) {
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onDirtyChange?.(true);
    // valuesは呼び出し側でフォームの全フィールドを都度並べて渡す設計のため、
    // 配列の中身を素直に依存配列として使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, values);
}
