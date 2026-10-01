import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { consumeBomItem } from "@/api/client";
import { preventEnterSubmit } from "@/lib/forms";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import type { BomCondition } from "@/types/bom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const UNORDERED = Number.MAX_SAFE_INTEGER;

export interface BomConsumeTarget {
  item_id: string;
  item_name: string | null;
  conditions: BomCondition[];
}

interface SelectorGroup {
  key: string;
  name: string;
  selectorType: "option" | "variation";
  order: number;
  choices: { selectorId: string; name: string; order: number }[];
}

// BOM行の条件に出てくる選択肢を「種類」「オプションごと」の選択欄にまとめる。
// 種類(バリエーション)は常に先頭
function buildSelectorGroups(conditions: BomCondition[]): SelectorGroup[] {
  const map = new Map<string, SelectorGroup>();
  for (const c of conditions) {
    const name = c.group_name ?? "?";
    const key = `${c.selector_type}:${name}`;
    const order = c.selector_type === "variation" ? -1 : (c.group_order ?? UNORDERED);
    if (!map.has(key)) {
      map.set(key, { key, name, selectorType: c.selector_type, order, choices: [] });
    }
    const group = map.get(key)!;
    group.order = Math.min(group.order, order);
    if (!group.choices.some((ch) => ch.selectorId === c.selector_id)) {
      group.choices.push({ selectorId: c.selector_id, name: c.choice_name ?? "?", order: c.choice_order ?? UNORDERED });
    }
  }
  const groups = [...map.values()].sort((a, b) => a.order - b.order);
  groups.forEach((g) => g.choices.sort((a, b) => a.order - b.order));
  return groups;
}

interface Props {
  shopId: number;
  target: BomConsumeTarget | null;
  onClose: () => void;
}

export default function BomConsumeDialog({ shopId, target, onClose }: Props) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const feedback = useSaveFeedback();
  const groups = target ? buildSelectorGroups(target.conditions) : [];

  const mutation = useMutation({
    mutationFn: () =>
      consumeBomItem(shopId, target!.item_id, {
        quantity,
        selections: groups
          .filter((g) => selected[g.key])
          .map((g) => ({ selector_type: g.selectorType, selector_id: selected[g.key] })),
        note: note || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      feedback.succeed("consume");
      setTimeout(onClose, 500);
    },
  });

  useEffect(() => {
    if (!target) return;
    setQuantity(1);
    setSelected({});
    setNote("");
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const missingVariation = groups.some((g) => g.selectorType === "variation" && !selected[g.key]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>「{target?.item_name ?? target?.item_id}」の在庫を消費する</DialogTitle>
          <DialogDescription>
            注文を作らずに、この商品に使う部品・中間品の在庫をまとめて減らします。商品自体の在庫は変わりません。
          </DialogDescription>
        </DialogHeader>
        <form id="bom-consume-form" onSubmit={handleSubmit} onKeyDown={preventEnterSubmit} className="grid gap-4">
          {groups.map((g) => (
            <div key={g.key} className="grid gap-1.5">
              <Label htmlFor={`bom-consume-${g.key}`}>
                {g.name}
                {g.selectorType === "variation" && <span className="text-destructive">*</span>}
              </Label>
              <select
                id={`bom-consume-${g.key}`}
                className={selectClass}
                value={selected[g.key] ?? ""}
                onChange={(e) => setSelected((prev) => ({ ...prev, [g.key]: e.target.value }))}
              >
                <option value="">{g.selectorType === "variation" ? "選択してください" : "選択しない"}</option>
                {g.choices.map((ch) => (
                  <option key={ch.selectorId} value={ch.selectorId}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="grid gap-1.5">
            <Label htmlFor="bom-consume-quantity">
              数量<span className="text-destructive">*</span>
            </Label>
            <NumberInput
              id="bom-consume-quantity"
              value={String(quantity)}
              onChange={(v) => setQuantity(Number(v))}
              className="w-32 text-right"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bom-consume-note">メモ</Label>
            <Input id="bom-consume-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </form>
        {mutation.error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {(mutation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            type="submit"
            form="bom-consume-form"
            disabled={mutation.isPending || missingVariation || quantity < 1}
          >
            {feedback.isFlashing("consume") ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-4" />
                消費しました
              </span>
            ) : mutation.isPending ? (
              "処理中..."
            ) : (
              "消費する"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
