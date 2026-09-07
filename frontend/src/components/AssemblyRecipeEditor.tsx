import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAssemblies, fetchParts } from "../api/client";
import type { MaterialType } from "../types/assembly";
import ComponentCombobox, { type ComponentOption } from "@/components/ComponentCombobox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import AssemblyMark from "@/components/AssemblyMark";
import ComponentLabel from "@/components/ComponentLabel";
import Hint from "@/components/Hint";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

export interface RecipeLine {
  material_type: MaterialType;
  material_id: number;
  quantity: number;
}

function lineKey(line: RecipeLine): string {
  return `${line.material_type}:${line.material_id}`;
}

interface Props {
  // 編集時はこの中間品自身を材料の選択肢から除外するために使う。新規作成時はnull
  assemblyId: number | null;
  lines: RecipeLine[];
  onChange: (lines: RecipeLine[]) => void;
}

export default function AssemblyRecipeEditor({ assemblyId, lines, onChange }: Props) {
  const partsQuery = useQuery({ queryKey: ["parts"], queryFn: fetchParts });
  const assembliesQuery = useQuery({ queryKey: ["assemblies"], queryFn: fetchAssemblies });

  const [newMaterialType, setNewMaterialType] = useState<MaterialType>("part");
  const [newMaterialId, setNewMaterialId] = useState<number | "">("");
  const [newQuantity, setNewQuantity] = useState(1);

  function handleAddLine(e: FormEvent) {
    e.preventDefault();
    if (newMaterialId === "") return;
    const key = `${newMaterialType}:${newMaterialId}`;
    if (lines.some((l) => lineKey(l) === key)) return;
    onChange([...lines, { material_type: newMaterialType, material_id: Number(newMaterialId), quantity: newQuantity }]);
    setNewMaterialId("");
    setNewQuantity(1);
  }

  function updateQuantity(key: string, quantity: number) {
    onChange(lines.map((l) => (lineKey(l) === key ? { ...l, quantity } : l)));
  }

  function removeLine(key: string) {
    onChange(lines.filter((l) => lineKey(l) !== key));
  }

  const partsById = new Map((partsQuery.data ?? []).map((p) => [p.id, p]));
  const assembliesById = new Map((assembliesQuery.data ?? []).map((a) => [a.id, a]));
  const availableMaterials: ComponentOption[] =
    newMaterialType === "part"
      ? (partsQuery.data ?? [])
      : (assembliesQuery.data ?? [])
          .filter((a) => a.id !== assemblyId)
          .map((a) => ({ ...a, type: "assembly" as const }));

  function materialName(line: RecipeLine): string {
    if (line.material_type === "part") {
      return partsById.get(line.material_id)?.name ?? `#${line.material_id}`;
    }
    return assembliesById.get(line.material_id)?.name ?? `#${line.material_id}`;
  }

  function materialPart(line: RecipeLine) {
    return line.material_type === "part" ? partsById.get(line.material_id) : undefined;
  }

  function materialAvailable(line: RecipeLine): number | undefined {
    if (line.material_type === "part") return partsById.get(line.material_id)?.available;
    return assembliesById.get(line.material_id)?.available;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>組成(レシピ)</CardTitle>
        <CardDescription>この中間品を作るのに必要な部品・中間品</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {lines.length > 0 && (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>材料</TableHead>
                <TableHead className="w-20">数量</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const key = lineKey(line);
                const available = materialAvailable(line);
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <span className="relative inline-flex">
                        {line.material_type === "assembly" ? (
                          <AssemblyMark group={assembliesById.get(line.material_id)?.group}>
                            {materialName(line)}
                          </AssemblyMark>
                        ) : (
                          <ComponentLabel
                            name={materialName(line)}
                            group={materialPart(line)?.group}
                            colors={materialPart(line)?.colors}
                            tags={materialPart(line)?.tags}
                          />
                        )}
                        {available !== undefined && (
                          <Hint label={`利用可能数: ${formatNumber(available)}`}>
                            <span
                              className={cn(
                                "absolute -top-3.5 -right-3 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium",
                                available <= 0
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                              )}
                            >
                              {formatNumber(available)}
                            </span>
                          </Hint>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberInput
                        value={String(line.quantity)}
                        onChange={(v) => updateQuantity(key, Number(v))}
                        className="w-20 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="destructive" size="sm" onClick={() => removeLine(key)}>
                        削除
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <form onSubmit={handleAddLine} className="grid gap-6 rounded-lg border bg-muted/40 dark:bg-muted/80 p-4">
          <div className="flex items-end gap-6">
            <div className="grid gap-1.5">
              <Label htmlFor="material-type" className="text-xs">種別</Label>
              <select
                id="material-type"
                className="h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                value={newMaterialType}
                onChange={(e) => {
                  setNewMaterialType(e.target.value as MaterialType);
                  setNewMaterialId("");
                }}
              >
                <option value="part">部品</option>
                <option value="assembly">中間品</option>
              </select>
            </div>
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="material-id" className="text-xs">材料</Label>
              <ComponentCombobox id="material-id" items={availableMaterials} value={newMaterialId} onChange={setNewMaterialId} />
            </div>
            <div className="grid w-20 gap-1.5">
              <Label htmlFor="material-quantity" className="text-xs">数量</Label>
              <NumberInput
                id="material-quantity"
                value={String(newQuantity)}
                onChange={(v) => setNewQuantity(Number(v))}
                className="text-right text-xs"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
              disabled={newMaterialId === ""}
            >
              行を追加
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
