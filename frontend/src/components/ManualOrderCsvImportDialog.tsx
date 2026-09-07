import { Fragment, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, UploadCloud } from "lucide-react";
import {
  createManualOrderImportProfile,
  deleteManualOrderImportProfile,
  fetchManualOrderImportProfiles,
  importManualOrders,
  previewManualOrdersCsv,
} from "@/api/client";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import { preventEnterSubmit } from "@/lib/forms";
import { cn } from "@/lib/utils";
import type { ManualOrderCsvColumnMapping, ManualOrderCsvPreview } from "@/types/manualItem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 dark:aria-invalid:border-destructive/50";

const UNUSED = "__unused__";

type Step = "upload" | "map" | "done";

const FIELD_DEFS: { key: keyof ManualOrderCsvColumnMapping; label: string; required?: boolean }[] = [
  { key: "item_id", label: "商品コード(item_id)", required: true },
  { key: "quantity", label: "数量" },
  { key: "variation_name", label: "バリエーション名" },
  { key: "price", label: "価格" },
  { key: "order_ref", label: "注文グループ化キー(同じ値の行を1注文にまとめる)" },
  { key: "ordered_at", label: "注文日時" },
  { key: "last_name", label: "姓" },
  { key: "first_name", label: "名" },
  { key: "prefecture", label: "都道府県" },
  { key: "address", label: "住所" },
  { key: "email", label: "メールアドレス" },
];

function guessMapping(columns: string[]): ManualOrderCsvColumnMapping {
  const byLower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  const pick = (key: string) => byLower.get(key.toLowerCase()) ?? undefined;
  return {
    item_id: pick("item_id") ?? "",
    quantity: pick("quantity"),
    variation_name: pick("variation_name"),
    price: pick("price"),
    order_ref: pick("order_ref"),
    ordered_at: pick("ordered_at"),
    last_name: pick("last_name"),
    first_name: pick("first_name"),
    prefecture: pick("prefecture"),
    address: pick("address"),
    email: pick("email"),
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: number;
  onImported: () => void;
}

export default function ManualOrderCsvImportDialog({ open, onOpenChange, shopId, onImported }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [preview, setPreview] = useState<ManualOrderCsvPreview | null>(null);
  const [mapping, setMapping] = useState<ManualOrderCsvColumnMapping>({ item_id: "" });
  const [selectedProfileId, setSelectedProfileId] = useState<number | "">("");
  const [newProfileName, setNewProfileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFeedback = useSaveFeedback();

  const profilesQuery = useQuery({
    queryKey: ["manual-order-import-profiles", shopId],
    queryFn: () => fetchManualOrderImportProfiles(shopId),
    enabled: open,
  });

  const previewMutation = useMutation({
    mutationFn: (f: File) => previewManualOrdersCsv(shopId, f, hasHeader),
    onSuccess: (data) => {
      setPreview(data);
      const profiles = profilesQuery.data ?? [];
      if (profiles.length === 1) {
        setSelectedProfileId(profiles[0].id);
        setMapping(profiles[0].mapping);
      } else {
        setMapping(guessMapping(data.columns));
      }
      setStep("map");
    },
  });

  const createProfileMutation = useMutation({
    mutationFn: () => createManualOrderImportProfile(shopId, { name: newProfileName, mapping }),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["manual-order-import-profiles", shopId] });
      setSelectedProfileId(profile.id);
      setNewProfileName("");
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: number) => deleteManualOrderImportProfile(shopId, profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual-order-import-profiles", shopId] });
      setSelectedProfileId("");
    },
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("ファイルが選択されていません");
      return importManualOrders(shopId, file, mapping, hasHeader);
    },
    onSuccess: () => {
      importFeedback.succeed("import");
      onImported();
      setStep("done");
    },
  });

  function reset() {
    setStep("upload");
    setFile(null);
    setHasHeader(true);
    setIsDragOver(false);
    setPreview(null);
    setMapping({ item_id: "" });
    setSelectedProfileId("");
    setNewProfileName("");
    previewMutation.reset();
    createProfileMutation.reset();
    importMutation.reset();
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleFile(f: File) {
    setFile(f);
    previewMutation.mutate(f);
  }

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function handleProfileSelected(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === "") {
      setSelectedProfileId("");
      return;
    }
    const id = Number(value);
    setSelectedProfileId(id);
    const profile = (profilesQuery.data ?? []).find((p) => p.id === id);
    if (profile) setMapping(profile.mapping);
  }

  function updateField(key: keyof ManualOrderCsvColumnMapping, value: string) {
    setMapping((prev) => ({ ...prev, [key]: value === UNUSED ? (key === "item_id" ? "" : null) : value }));
  }

  function handleImportSubmit(e: FormEvent) {
    e.preventDefault();
    importMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {step === "upload" && (
          <>
            <DialogHeader>
              <DialogTitle>CSVインポート</DialogTitle>
              <DialogDescription>
                注文が入ったCSVファイルを選択してください。次の画面で列の対応付けを行います。
              </DialogDescription>
            </DialogHeader>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
                isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
              )}
            >
              <UploadCloud className="size-8 text-muted-foreground-subtle" />
              <p className="text-sm font-medium">ここにCSVファイルをドロップ</p>
              <p className="text-xs text-muted-foreground-subtle">またはクリックしてファイルを選択</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelected}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch checked={hasHeader} onCheckedChange={setHasHeader} />
              1行目を項目名(ヘッダー)として扱う
            </label>

            {previewMutation.isPending && <p className="text-sm text-muted-foreground">読み込み中...</p>}
            {previewMutation.error && (
              <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {(previewMutation.error as Error).message}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                キャンセル
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "map" && preview && (
          <>
            <DialogHeader>
              <DialogTitle>列の対応付け</DialogTitle>
              <DialogDescription>
                CSVのどの列をUniStockのどの項目として読み込むか選択してください(商品コードは必須)。
              </DialogDescription>
            </DialogHeader>

            {(profilesQuery.data?.length ?? 0) > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="import-profile">保存済みの設定を使う</Label>
                <div className="flex items-center gap-2">
                  <select
                    id="import-profile"
                    className={selectClass}
                    value={selectedProfileId}
                    onChange={handleProfileSelected}
                  >
                    <option value="">(選択してください)</option>
                    {profilesQuery.data!.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {selectedProfileId !== "" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => deleteProfileMutation.mutate(selectedProfileId as number)}
                      disabled={deleteProfileMutation.isPending}
                    >
                      削除
                    </Button>
                  )}
                </div>
              </div>
            )}

            <form
              id="mapping-form"
              onSubmit={handleImportSubmit}
              onKeyDown={preventEnterSubmit}
              className="grid grid-cols-[max-content_1fr_max-content] items-center gap-x-3 gap-y-2"
            >
              {FIELD_DEFS.map((f) => {
                const value = mapping[f.key];
                const sample = value ? preview.sample_rows[0]?.[value] : undefined;
                return (
                  <Fragment key={f.key}>
                    <Label htmlFor={`map-${f.key}`} className="text-sm whitespace-nowrap">
                      {f.label}
                      {f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <select
                      id={`map-${f.key}`}
                      className={cn(selectClass, "w-full min-w-0")}
                      value={value || UNUSED}
                      onChange={(e) => updateField(f.key, e.target.value)}
                      aria-invalid={f.required && !value}
                    >
                      <option value={UNUSED}>(使用しない)</option>
                      {preview.columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <span className="max-w-40 truncate text-xs text-muted-foreground-subtle">
                      {sample ? `例: ${sample}` : ""}
                    </span>
                  </Fragment>
                );
              })}
            </form>

            <div className="grid gap-1.5 rounded-lg border border-border p-3">
              <Label htmlFor="new-profile-name" className="text-xs">
                この設定を名前を付けて保存(次回からマッピング操作なしで使えます)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="new-profile-name"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="例: BOOTH注文CSV"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!newProfileName || !mapping.item_id || createProfileMutation.isPending}
                  onClick={() => createProfileMutation.mutate()}
                >
                  保存
                </Button>
              </div>
              {createProfileMutation.error && (
                <p className="text-xs text-destructive">{(createProfileMutation.error as Error).message}</p>
              )}
            </div>

            {importMutation.error && (
              <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {(importMutation.error as Error).message}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("upload")}>
                戻る
              </Button>
              <Button type="submit" form="mapping-form" disabled={!mapping.item_id || importMutation.isPending}>
                {importMutation.isPending ? "インポート中..." : "インポート実行"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && importMutation.data && (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  インポートしました
                </span>
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-col gap-1">
                  <span>新規{importMutation.data.created}件</span>
                  {importMutation.data.errors.length > 0 && (
                    <span className="text-destructive">エラー{importMutation.data.errors.length}件</span>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>
            {importMutation.data.errors.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-destructive">
                {importMutation.data.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>閉じる</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
