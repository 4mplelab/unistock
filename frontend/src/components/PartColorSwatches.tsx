import { partColorHex, usePartColors } from "@/lib/partColor";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 一覧で部品の実物の色をスウォッチ(丸)で表示する。デュアルカラーは複数個並べる */
export default function PartColorSwatches({ colors }: { colors: string[] | null }) {
  const palette = usePartColors();
  if (!colors || colors.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-0.5">
          {colors.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/15 dark:ring-foreground/40"
              style={{ backgroundColor: partColorHex(c, palette) }}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>{colors.join(" / ")}</TooltipContent>
    </Tooltip>
  );
}
