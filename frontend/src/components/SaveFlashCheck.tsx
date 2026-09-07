import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** 自動保存フィールドの隣に置く、保存成功時だけ一瞬光るチェックマーク。
 * 常時マウントしたままopacityだけトグルする(AppShell.tsxのホバーフェードと同じ手法)ため、
 * 表示/非表示でレイアウトが動かない */
export default function SaveFlashCheck({ show, className }: { show: boolean; className?: string }) {
  return (
    <Check
      aria-hidden={!show}
      className={cn(
        "size-4 shrink-0 text-green-600 transition-opacity duration-500 dark:text-green-400",
        show ? "opacity-100" : "opacity-0",
        className
      )}
    />
  );
}
