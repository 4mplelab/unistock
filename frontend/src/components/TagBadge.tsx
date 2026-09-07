import type { CSSProperties } from "react";
import { tagColor } from "@/lib/tagColor";
import { cn } from "@/lib/utils";

export default function TagBadge({ tag, className }: { tag: string; className?: string }) {
  const { light, dark } = tagColor(tag);
  const style = { "--tag-color-light": light, "--tag-color-dark": dark } as CSSProperties;

  return (
    <span
      className={cn(
        "tag-color-badge inline-flex h-5 w-fit shrink-0 items-center rounded-4xl px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className
      )}
      style={style}
    >
      {tag}
    </span>
  );
}
