import { CircleSlash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Hint from "@/components/Hint";

/** BOM行が component_type="none"(意図的に部品を消費しない)であることを示す表示。
 * 行が1つも無い「未設定」との混同を避けるため、アイコン付きのラベルとして表示する。 */
export default function NoPartsNeededMark({ className }: { className?: string }) {
  return (
    <Hint label="意図的に部品を消費しない設定です">
      <span className={cn("inline-flex items-center gap-1 text-muted-foreground-subtle", className)}>
        <CircleSlash2 className="size-3.5" aria-hidden="true" />
        部品不要
      </span>
    </Hint>
  );
}
