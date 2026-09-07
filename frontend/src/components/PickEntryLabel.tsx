import { Link } from "react-router-dom";
import type { PickListEntry } from "../types/order_summary";
import ComponentLabel from "@/components/ComponentLabel";
import { cn } from "@/lib/utils";

function ComponentDot({ type }: { type: "part" | "assembly" }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        type === "assembly" ? "bg-violet-500 dark:bg-violet-400" : "bg-muted-foreground-subtle"
      )}
    />
  );
}

// 部品・中間品の必要数を表示する箇所(ピッキング・注文サマリなど)で共通利用する行ラベル。
// 中間品は部品と見た目を区別する(紫のドット+文字色、部品編集画面ではなく中間品編集画面へのリンク)
export default function PickEntryLabel({ entry }: { entry: PickListEntry }) {
  const to = entry.component_type === "assembly" ? `/assemblies/${entry.id}/edit` : `/parts/${entry.id}/edit`;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ComponentDot type={entry.component_type} />
      <Link
        to={to}
        className={cn(
          "group flex min-w-0 underline-offset-2",
          entry.component_type !== "assembly" && "text-primary"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {entry.component_type === "assembly" ? (
          <span className="min-w-0 truncate font-medium text-violet-600 dark:text-violet-400 group-hover:underline">
            {entry.name}
          </span>
        ) : (
          <ComponentLabel name={entry.name} group={entry.group} colors={entry.colors} />
        )}
      </Link>
    </span>
  );
}
