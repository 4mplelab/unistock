import { useCallback, useEffect } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";

/**
 * 未保存の変更がある編集画面で、離脱(アプリ内遷移・タブを閉じる/リロード)を確認する。
 *
 * - アプリ内遷移(サイドバーのリンク・ブラウザの戻る/進む含む)はuseBlockerで捕捉し、
 *   呼び出し側が返されたblockerを使って確認ダイアログを出す(<UnsavedChangesDialog>参照)
 * - タブを閉じる/リロード/直接URL入力による離脱はbeforeunloadで捕捉する
 *   (ブラウザ標準の確認ダイアログが出る。文言はカスタマイズ不可)
 *
 * isDirtyがfalseになった瞬間(保存成功時など)は両方とも自動的に効かなくなる。
 * 保存後にnavigate()する場合は、isDirtyをfalseに戻してから呼び出すこと
 * (falseに戻さないと、保存直後の意図した画面遷移までブロックしてしまう)。
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname,
    [isDirty]
  );
  return useBlocker(shouldBlock);
}
