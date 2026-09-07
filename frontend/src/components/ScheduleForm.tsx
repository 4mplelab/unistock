import { FormEvent, useEffect, useState } from "react";
import type { StockScheduleCreateInput } from "../types/schedule";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import ItemCombobox, { type SelectedItem } from "@/components/ItemCombobox";
import { useShopContext } from "@/contexts/ShopContext";
import { toDatetimeLocalInput } from "@/lib/datetime";
import { preventEnterSubmit } from "@/lib/forms";

export const SCHEDULE_CREATE_FORM_ID = "schedule-create-form";

interface Props {
  onSubmit: (input: StockScheduleCreateInput) => void;
  onReadyChange?: (ready: boolean) => void;
}

export default function ScheduleForm({ onSubmit, onReadyChange }: Props) {
  const { currentShopId: shopId, currentShop } = useShopContext();
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [targetStock, setTargetStock] = useState(0);
  // 現在日時ちょうどだとスケジューラーの実行タイミング次第で「過去」扱いになりうるため1分先を初期値にする
  const [runAt, setRunAt] = useState(() => toDatetimeLocalInput(new Date(Date.now() + 60_000)));
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    onReadyChange?.(!!shopId && !!selectedItem);
  }, [shopId, selectedItem, onReadyChange]);

  // noValidateでブラウザのdatetime-local書式チェックを無効化しているため、
  // 「空でない」だけでなく実際にパースできる日時かどうかも自前で確認する
  const runAtDate = runAt ? new Date(runAt) : null;
  const isRunAtValid = !!runAtDate && !isNaN(runAtDate.getTime());

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (!shopId || !selectedItem || !isRunAtValid) return;
    onSubmit({
      shop_id: shopId,
      item_id: selectedItem.item_id,
      item_name: selectedItem.item_name,
      target_stock: targetStock,
      run_at: runAtDate!.toISOString(),
    });
  }

  return (
    <form
      id={SCHEDULE_CREATE_FORM_ID}
      onSubmit={handleSubmit}
      onKeyDown={preventEnterSubmit}
      noValidate
      className="grid max-w-md gap-5"
    >
      <div className="grid gap-1.5">
        <Label>ショップ</Label>
        {currentShop ? (
          <p className="text-sm">{currentShop.name}</p>
        ) : (
          <p className="text-sm text-destructive">
            ショップが選択されていません。ヘッダーの切り替えメニューから選んでください
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label>
          商品 <span className="text-destructive">*</span>
        </Label>
        {shopId != null && (
          <ItemCombobox
            shopId={shopId}
            value={selectedItem}
            onChange={setSelectedItem}
            invalid={hasAttemptedSubmit && !selectedItem}
          />
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="target_stock">
          在庫数 <span className="text-destructive">*</span>
        </Label>
        <NumberInput
          id="target_stock"
          value={String(targetStock)}
          onChange={(v) => setTargetStock(Number(v))}
          required
          className="w-32 text-right"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="run_at">
          実行日時 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="run_at"
          type="datetime-local"
          value={runAt}
          onChange={(e) => setRunAt(e.target.value)}
          aria-invalid={hasAttemptedSubmit && !isRunAtValid}
          required
          className="w-56"
        />
      </div>
    </form>
  );
}
