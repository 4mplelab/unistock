import { usePartColors } from "@/lib/partColor";
import { cn } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (colors: string[]) => void;
}

/** 部品の実物の色を複数選択するピッカー。デュアルカラー等は複数選択で表現する */
export default function PartColorPicker({ value, onChange }: Props) {
  const colors = usePartColors();

  function toggle(name: string) {
    onChange(value.includes(name) ? value.filter((c) => c !== name) : [...value, name]);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const selected = value.includes(c.name);
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => toggle(c.name)}
            aria-pressed={selected}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              selected ? "border-ring bg-accent text-accent-foreground" : "border-input text-muted-foreground hover:bg-muted/50"
            )}
          >
            <span
              className="size-3 shrink-0 rounded-full ring-1 ring-foreground/15 dark:ring-foreground/40"
              style={{ backgroundColor: c.hex }}
            />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
