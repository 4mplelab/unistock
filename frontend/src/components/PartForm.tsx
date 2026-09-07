import { FormEvent, useState } from "react";
import type { Part, PartCreateInput } from "../types/part";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PartColorPicker from "@/components/PartColorPicker";
import { cn } from "@/lib/utils";
import { preventEnterSubmit } from "@/lib/forms";
import { MAX_TAG_LENGTH, MAX_TAGS } from "@/lib/tags";
import { formatNumber } from "@/lib/format";
import { useDirtyTracking } from "@/hooks/useDirtyTracking";

export const PART_FORM_ID = "part-form";

interface Props {
  initial?: Part;
  // 複製元の部品。initialと違い編集中の実レコードではないため、在庫数・SKU・発注中バッジ・
  // 「在庫数を直接変更した場合のメモ」欄には反映しない(新規作成として空のまま扱う)
  duplicateFrom?: Part;
  onSubmit: (input: PartCreateInput) => void;
  // 初期値から何かしら変更されたら一度だけtrueで呼ばれる(未保存の変更ガード用、編集画面のみ渡す想定)
  onDirtyChange?: (dirty: boolean) => void;
}

export default function PartForm({ initial, duplicateFrom, onSubmit, onDirtyChange }: Props) {
  const source = initial ?? duplicateFrom;
  const [name, setName] = useState(source?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [stock, setStock] = useState(initial?.stock ?? 0);
  const [unitCost, setUnitCost] = useState(source?.unit_cost?.toString() ?? "");
  const [tags, setTags] = useState(source?.tags?.join(", ") ?? "");
  const [group, setGroup] = useState(source?.group ?? "");
  const [colors, setColors] = useState<string[]>(source?.colors ?? []);
  const [purchaseUrl, setPurchaseUrl] = useState(source?.purchase_url ?? "");
  const [reorderThreshold, setReorderThreshold] = useState(source?.reorder_threshold?.toString() ?? "");
  const [purchasable, setPurchasable] = useState(source?.purchasable ?? true);
  const [memo, setMemo] = useState(source?.memo ?? "");
  const [note, setNote] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const tagCount = tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0).length;

  useDirtyTracking(
    [name, sku, stock, unitCost, tags, group, colors, purchaseUrl, reorderThreshold, purchasable, memo, note],
    onDirtyChange
  );

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
      colors: colors.length > 0 ? colors : null,
      purchase_url: purchaseUrl || null,
      reorder_threshold: purchasable && reorderThreshold !== "" ? Number(reorderThreshold) : null,
      purchasable,
      memo,
      note: note || null,
    });
  }

  return (
    <form
      id={PART_FORM_ID}
      onSubmit={handleSubmit}
      onKeyDown={preventEnterSubmit}
      noValidate
      className="grid max-w-md gap-5"
    >
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor="purchasable">発注管理する</Label>
          <p className="text-xs text-muted-foreground-subtle">
            オフにすると仕入れ先への発注は行わず、在庫追加のみで管理する部品(自社製造品など)になります
          </p>
        </div>
        <Switch id="purchasable" checked={purchasable} onCheckedChange={setPurchasable} />
      </div>
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
        <div className="flex items-center justify-between">
          <Label htmlFor="stock">
            在庫数 <span className="text-destructive">*</span>
          </Label>
          {initial && initial.ordered_quantity > 0 && (
            <span className="text-xs text-muted-foreground-subtle">
              発注中 <span className="font-medium text-foreground">{formatNumber(initial.ordered_quantity)}</span>
            </span>
          )}
        </div>
        <NumberInput
          id="stock"
          value={String(stock)}
          onChange={(v) => setStock(Number(v))}
          required
          className="w-32 text-right"
        />
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
        <Label htmlFor="unit_cost">単価（円）</Label>
        <NumberInput
          id="unit_cost"
          value={unitCost}
          onChange={setUnitCost}
          className="w-32 text-right"
        />
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
          placeholder={`カンマ区切りで複数入力可、最大${MAX_TAGS}個・各${MAX_TAG_LENGTH}文字まで（例: 電子部品, 汎用）`}
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
        <Label>カラー</Label>
        <PartColorPicker value={colors} onChange={setColors} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="purchase_url">購入先URL</Label>
        <Input
          id="purchase_url"
          type="url"
          value={purchaseUrl}
          onChange={(e) => setPurchaseUrl(e.target.value)}
        />
      </div>
      {purchasable && (
        <div className="grid gap-1.5">
          <Label htmlFor="reorder_threshold">発注点</Label>
          <NumberInput
            id="reorder_threshold"
            value={reorderThreshold}
            onChange={setReorderThreshold}
            placeholder="この数値を下回ったら要発注（未入力で対象外）"
            className="w-56 text-right"
          />
        </div>
      )}
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
