import { FormEvent, useState } from "react";
import type { Assembly, AssemblyCreateInput } from "../types/assembly";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { preventEnterSubmit } from "@/lib/forms";
import { MAX_TAG_LENGTH, MAX_TAGS } from "@/lib/tags";
import { useDirtyTracking } from "@/hooks/useDirtyTracking";

export const ASSEMBLY_FORM_ID = "assembly-form";

interface Props {
  initial?: Assembly;
  // 複製元の中間品。initialと違い編集中の実レコードではないため、在庫数・SKU・
  // 「在庫数を直接変更した場合のメモ」欄には反映しない(新規作成として空のまま扱う)
  duplicateFrom?: Assembly;
  onSubmit: (input: AssemblyCreateInput) => void;
  // 初期値から何かしら変更されたら一度だけtrueで呼ばれる(未保存の変更ガード用、編集画面のみ渡す想定)
  onDirtyChange?: (dirty: boolean) => void;
}

export default function AssemblyForm({ initial, duplicateFrom, onSubmit, onDirtyChange }: Props) {
  const source = initial ?? duplicateFrom;
  const [name, setName] = useState(source?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [stock, setStock] = useState(initial?.stock ?? 0);
  const [unitCost, setUnitCost] = useState(source?.unit_cost?.toString() ?? "");
  const [tags, setTags] = useState(source?.tags?.join(", ") ?? "");
  const [group, setGroup] = useState(source?.group ?? "");
  const [memo, setMemo] = useState(source?.memo ?? "");
  const [note, setNote] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const tagCount = tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0).length;

  useDirtyTracking([name, sku, stock, unitCost, tags, group, memo, note], onDirtyChange);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (!name) return;
    const tagList = tags
      .split(",")
      .map((t) => t.trim().slice(0, MAX_TAG_LENGTH))
      .filter((t) => t.length > 0)
      .slice(0, MAX_TAGS);
    onSubmit({
      name,
      sku: sku || null,
      stock,
      unit_cost: unitCost === "" ? null : Number(unitCost),
      tags: tagList.length > 0 ? tagList : null,
      group: group || null,
      memo,
      note: note || null,
    });
  }

  return (
    <form
      id={ASSEMBLY_FORM_ID}
      onSubmit={handleSubmit}
      onKeyDown={preventEnterSubmit}
      noValidate
      className="grid max-w-md gap-5"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="name">
          名前 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={hasAttemptedSubmit && !name}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sku">SKU</Label>
        <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="stock">
          在庫数 <span className="text-destructive">*</span>
        </Label>
        <NumberInput
          id="stock"
          value={String(stock)}
          onChange={(v) => setStock(Number(v))}
          required
          className="w-32 text-right"
        />
        <p className="text-xs text-muted-foreground-subtle">組立操作で自動的に増減します。手動での訂正にも使えます</p>
      </div>
      {initial && (
        <div className="grid gap-1.5">
          <Label htmlFor="note">在庫数を直接変更した場合のメモ</Label>
          <Input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例: 棚卸しで判明した差分(在庫数を変更した場合のみ履歴に記録されます)"
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="unit_cost">追加費用（円）</Label>
        <NumberInput
          id="unit_cost"
          value={unitCost}
          onChange={setUnitCost}
          className="w-32 text-right"
        />
        <p className="text-xs text-muted-foreground-subtle">
          組み立て工賃・外注費など、部品原価だけでは表せない追加費用。中間品の実際の原価は
          この値＋レシピの部品原価合計で計算されます
        </p>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="tags">タグ</Label>
          <span
            className={cn(
              "text-xs",
              tagCount > MAX_TAGS ? "text-destructive" : "text-muted-foreground-subtle"
            )}
          >
            {tagCount}/{MAX_TAGS}
          </span>
        </div>
        <Input
          id="tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder={`カンマ区切りで複数入力可、最大${MAX_TAGS}個・各${MAX_TAG_LENGTH}文字まで（例: モジュール, 汎用）`}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="group">グループ</Label>
        <Input
          id="group"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="一覧の絞り込み・並び替え用の分類"
          className="w-56"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="memo">メモ</Label>
        <Textarea
          id="memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
        />
      </div>
    </form>
  );
}
