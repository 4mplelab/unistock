import { FormEvent, useState } from "react";
import type { ManualItemVariationUpsertInput } from "@/types/manualItem";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// 既存(id持ち)・新規(idなし)を同じ配列で扱う。行の同一性はUI上の並び順(index)で
// 追跡すれば十分(サーバーへの送信直前にidの有無だけで新規/更新を振り分ける)
interface Props {
  lines: ManualItemVariationUpsertInput[];
  onChange: (lines: ManualItemVariationUpsertInput[]) => void;
}

export default function ManualItemVariationEditor({ lines, onChange }: Props) {
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState("0");
  const [bulkPrice, setBulkPrice] = useState("");

  function applyBulkPrice() {
    if (bulkPrice === "") return;
    const value = Number(bulkPrice);
    onChange(lines.map((l) => ({ ...l, price: value })));
  }

  function handleAddLine(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    onChange([
      ...lines,
      { name: newName.trim(), price: newPrice === "" ? null : Number(newPrice), stock: Number(newStock || "0") },
    ]);
    setNewName("");
    setNewPrice("");
    setNewStock("0");
  }

  function updateLine(index: number, patch: Partial<ManualItemVariationUpsertInput>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>バリエーション</CardTitle>
        <CardDescription>
          色・サイズなど、この商品が持つ単一軸の選択肢です。BOM編集画面の「単一選択肢」条件として使えます。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {lines.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="grid w-28 gap-1.5">
              <Label htmlFor="variation-bulk-price" className="text-xs">価格を一括設定</Label>
              <NumberInput
                id="variation-bulk-price"
                value={bulkPrice}
                onChange={setBulkPrice}
                className="h-8 text-right text-xs"
              />
            </div>
            <Button type="button" variant="outline" size="sm" disabled={bulkPrice === ""} onClick={applyBulkPrice}>
              全バリエーションに適用
            </Button>
          </div>
        )}
        {lines.length > 0 && (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead className="w-28 text-right">
                  価格(円) <span className="text-destructive">*</span>
                </TableHead>
                <TableHead className="w-24 text-right">在庫</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.id ?? `new-${index}`}>
                  <TableCell>
                    <Input
                      value={line.name}
                      onChange={(e) => updateLine(index, { name: e.target.value })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberInput
                      value={line.price != null ? String(line.price) : ""}
                      onChange={(v) => updateLine(index, { price: v === "" ? null : Number(v) })}
                      aria-invalid={line.price == null}
                      className="h-8 w-28 text-right text-xs"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberInput
                      value={String(line.stock)}
                      onChange={(v) => updateLine(index, { stock: Number(v || "0") })}
                      className="h-8 w-20 text-right text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="destructive" size="sm" onClick={() => removeLine(index)}>
                      削除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form onSubmit={handleAddLine} className="grid gap-6 rounded-lg border bg-muted/40 dark:bg-muted/80 p-4">
          <div className="flex items-end gap-6">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="variation-name" className="text-xs">名前</Label>
              <Input
                id="variation-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: ホワイト"
                className="h-8"
              />
            </div>
            <div className="grid w-28 gap-1.5">
              <Label htmlFor="variation-price" className="text-xs">
                価格(円)
              </Label>
              <NumberInput
                id="variation-price"
                value={newPrice}
                onChange={setNewPrice}
                className="h-8 text-right text-xs"
              />
            </div>
            <div className="grid w-20 gap-1.5">
              <Label htmlFor="variation-stock" className="text-xs">在庫</Label>
              <NumberInput
                id="variation-stock"
                value={newStock}
                onChange={setNewStock}
                className="h-8 text-right text-xs"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
              disabled={!newName.trim()}
            >
              行を追加
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
