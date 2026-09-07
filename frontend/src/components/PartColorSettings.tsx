import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { updateSetting } from "@/api/client";
import { cn } from "@/lib/utils";
import { PART_COLORS_SETTING_KEY, usePartColors, type PartColorDef } from "@/lib/partColor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SaveFlashCheck from "@/components/SaveFlashCheck";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";

const colorInputClass = "size-8 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5";

/** 部品のカラーで使う基本色パレットの管理UI。設定(part_colors)に保存し、
 * ビルド・デプロイなしで色の追加・変更・削除ができるようにする。
 * 既存の色の名前は変更不可(部品側がその名前で色を参照しているため、
 * リネームすると既存の紐付けが壊れる) */
export default function PartColorSettings() {
  const queryClient = useQueryClient();
  const savedColors = usePartColors();
  const [colors, setColors] = useState<PartColorDef[]>(savedColors);
  const [newName, setNewName] = useState("");
  const [newHex, setNewHex] = useState("#888888");

  useEffect(() => setColors(savedColors), [JSON.stringify(savedColors)]);

  const saveMutation = useMutation({
    mutationFn: (next: PartColorDef[]) => updateSetting(PART_COLORS_SETTING_KEY, JSON.stringify(next)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  const feedback = useSaveFeedback();

  function persist(next: PartColorDef[], feedbackKey: string) {
    setColors(next);
    saveMutation.mutate(next, feedback.callbacks(feedbackKey));
  }

  function updateHex(index: number, hex: string) {
    persist(
      colors.map((c, i) => (i === index ? { ...c, hex } : c)),
      `hex:${colors[index].name}`
    );
  }

  function removeColor(index: number) {
    persist(
      colors.filter((_, i) => i !== index),
      `remove:${colors[index].name}`
    );
  }

  function addColor() {
    const name = newName.trim();
    if (!name || colors.some((c) => c.name === name)) return;
    persist([...colors, { name, hex: newHex }], "add");
    setNewName("");
    setNewHex("#888888");
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {colors.map((c, i) => (
          <div key={c.name} className="grid gap-1">
            <div className="flex items-center gap-3 rounded-lg border p-2">
              <input
                type="color"
                value={c.hex}
                onChange={(e) => updateHex(i, e.target.value)}
                className={colorInputClass}
                aria-label={`${c.name}の色`}
              />
              <span className="w-24 truncate text-sm">{c.name}</span>
              <span className="font-mono text-xs text-muted-foreground-subtle">{c.hex}</span>
              <SaveFlashCheck show={feedback.isFlashing(`hex:${c.name}`)} className="ml-auto" />
              <Button
                variant="ghost"
                size="sm"
                className={cn("text-destructive", !feedback.isFlashing(`hex:${c.name}`) && "ml-auto")}
                onClick={() => removeColor(i)}
              >
                {feedback.isFlashing(`remove:${c.name}`) ? (
                  <span className="inline-flex items-center gap-1">
                    <Check className="size-4" />
                    削除しました
                  </span>
                ) : (
                  "削除"
                )}
              </Button>
            </div>
            <FieldError message={feedback.errorFor(`hex:${c.name}`)} />
            <FieldError message={feedback.errorFor(`remove:${c.name}`)} />
          </div>
        ))}
      </div>

      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <input
            type="color"
            value={newHex}
            onChange={(e) => setNewHex(e.target.value)}
            className={colorInputClass}
            aria-label="新しい色"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="色の名前（例: オレンジ）"
            className="w-40"
          />
          <Button variant="outline" size="sm" onClick={addColor} disabled={!newName.trim()}>
            {feedback.isFlashing("add") ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-4" />
                追加しました
              </span>
            ) : (
              "追加"
            )}
          </Button>
        </div>
        <FieldError message={feedback.errorFor("add")} />
      </div>
    </div>
  );
}
