import { useRef, useState } from "react";

/**
 * 自動保存フィールド・アクションボタンの成功/失敗フィードバックを共通化する。
 *
 * 成功: `isFlashing(key)`が一定時間だけtrueになる(呼び出し側はチェックマークの
 * フェード表示やボタンラベルの一時差し替えに使う)。失敗: `errorFor(key)`に
 * メッセージが残り続け、次にその同じkeyで再送信するまで消えない。
 *
 * 1ページ内で1つの`useMutation`を複数フィールドが共有していても(SettingsPageの
 * `updateSetting`等)、`mutate(value, feedback.callbacks("フィールド固有のkey"))`
 * のようにmutate呼び出しごとにコールバックを渡せる(TanStack Queryの仕様)ため、
 * mutation定義自体は変えずにこのフックを被せるだけで済む。
 */
export function useSaveFeedback(flashDurationMs = 1500) {
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function succeed(key: string) {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: null } : prev));
    setFlashing((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      setFlashing((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, flashDurationMs);
  }

  function fail(key: string, message: string) {
    setErrors((prev) => ({ ...prev, [key]: message }));
  }

  function callbacks(key: string) {
    return {
      onMutate: () => {
        setErrors((prev) => (prev[key] ? { ...prev, [key]: null } : prev));
      },
      onSuccess: () => succeed(key),
      onError: (e: unknown) => fail(key, e instanceof Error ? e.message : "失敗しました"),
    };
  }

  return {
    isFlashing: (key: string) => flashing.has(key),
    errorFor: (key: string) => errors[key] ?? null,
    callbacks,
    succeed,
    fail,
  };
}
