import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import Hint from "@/components/Hint";
import GroupChip from "@/components/GroupChip";

/** 部品/中間品の名前を包んで、中間品であることを名前自体の文字色で示す。
 * 「部品/中間品」列内での表示なので文言は繰り返さず、色だけで区別する
 * (ホバーで補足のツールチップを出す)。groupを渡すと、部品側のComponentLabelと
 * 同様にグループチップも横並びで表示する */
export default function AssemblyMark({
  children,
  group,
  className,
}: {
  children: ReactNode;
  group?: string | null;
  className?: string;
}) {
  return (
    <Hint label="中間品">
      <span className={cn("inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-400", className)}>
        {children}
        {group && <GroupChip group={group} />}
      </span>
    </Hint>
  );
}
