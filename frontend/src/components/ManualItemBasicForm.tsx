import { FormEvent, useState } from "react";
import type { ManualItem } from "@/types/manualItem";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { preventEnterSubmit } from "@/lib/forms";
import { useDirtyTracking } from "@/hooks/useDirtyTracking";

export const MANUAL_ITEM_FORM_ID = "manual-item-basic-form";

export interface ManualItemBasicInput {
  item_id?: string;
  title: string;
  price: number | null;
  stock: number;
  description: string | null;
}

interface Props {
  // 編集時はこの商品自身。新規作成時は無し(商品コードの入力欄を出す)
  initial?: ManualItem;
  // 複製元の商品。initialと違い編集中の実レコードではないため、商品コード・在庫数には
  // 反映しない(新規作成として空/0のまま扱う)
  duplicateFrom?: ManualItem;
  // バリエーションを1件以上登録しているかどうか(呼び出し元のバリエーション編集状態から渡す)。
  // trueの間は本体(共通)価格を入力欄ごと非表示にする(価格は必ずバリエーションごとに
  // 持たせる設計のため、本体側にフォールバック用の値を残す意味が無い)
  hasVariations?: boolean;
  onSubmit: (input: ManualItemBasicInput) => void;
  // 初期値から何かしら変更されたら一度だけtrueで呼ばれる(未保存の変更ガード用、編集画面のみ渡す想定)
  onDirtyChange?: (dirty: boolean) => void;
}

export default function ManualItemBasicForm({ initial, duplicateFrom, hasVariations, onSubmit, onDirtyChange }: Props) {
  const isCreate = !initial;
  const source = initial ?? duplicateFrom;
  const [itemId, setItemId] = useState("");
  const [title, setTitle] = useState(source?.title ?? "");
  const [price, setPrice] = useState(source?.price != null ? String(source.price) : "");
  const [stock, setStock] = useState(initial ? String(initial.stock) : "0");
  const [description, setDescription] = useState(source?.description ?? "");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useDirtyTracking([title, price, stock, description], onDirtyChange);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (!title.trim() || (isCreate && !itemId.trim())) return;
    onSubmit({
      item_id: isCreate ? itemId.trim() : undefined,
      title: title.trim(),
      // バリエーションを持つ商品は、本体価格を持たせない(必ずバリエーション側の価格を使う)
      price: hasVariations ? null : price === "" ? null : Number(price),
      stock: Number(stock || "0"),
      description: description.trim() || null,
    });
  }

  return (
    <form
      id={MANUAL_ITEM_FORM_ID}
      onSubmit={handleSubmit}
      onKeyDown={preventEnterSubmit}
      noValidate
      className="grid max-w-md gap-5"
    >
      {isCreate && (
        <div className="grid gap-1.5">
          <Label htmlFor="manual-item-id">
            商品コード <span className="text-destructive">*</span>
          </Label>
          <Input
            id="manual-item-id"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder="例: item-001(あとから変更できません)"
            aria-invalid={hasAttemptedSubmit && !itemId.trim()}
            required
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="manual-item-title">
          商品名 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="manual-item-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={hasAttemptedSubmit && !title.trim()}
          required
        />
      </div>
      {hasVariations ? (
        <div className="grid gap-1.5">
          <Label htmlFor="manual-item-stock">
            在庫数 <span className="text-destructive">*</span>
          </Label>
          <NumberInput
            id="manual-item-stock"
            value={stock}
            onChange={setStock}
            required
            className="w-32 text-right"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="manual-item-price">価格(円)</Label>
            <NumberInput id="manual-item-price" value={price} onChange={setPrice} className="text-right" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-item-stock">
              在庫数 <span className="text-destructive">*</span>
            </Label>
            <NumberInput id="manual-item-stock" value={stock} onChange={setStock} required className="text-right" />
          </div>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="manual-item-description">メモ</Label>
        <Textarea
          id="manual-item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>
    </form>
  );
}
