import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 素早く出るツールチップ(ネイティブtitle属性のOS依存の遅延を避けるため)。
 * labelがnull/undefined/空文字ならツールチップなしでそのまま子要素を返す */
export default function Hint({
  label,
  children,
  side,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (!label) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
