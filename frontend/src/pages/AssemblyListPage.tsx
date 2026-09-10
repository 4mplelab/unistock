import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildAssembly,
  deleteAssembly,
  exportAssembliesCsv,
  fetchAssemblies,
  fetchAssembliesBuildableAvailable,
  fetchAssembliesCosts,
  fetchAssemblyReservations,
  importAssembliesCsv,
} from "../api/client";
import type { Assembly } from "../types/assembly";
import ReservingOrdersDialog from "../components/ReservingOrdersDialog";
import { useReservationLookup } from "../hooks/useReservationLookup";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check, MoreVertical } from "lucide-react";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import TagBadge from "../components/TagBadge";
import GroupChip from "../components/GroupChip";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { preventEnterSubmit } from "@/lib/forms";
import { readStoredToggle, writeStoredToggle } from "@/lib/storage";
import Hint from "@/components/Hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function matchesSearch(assembly: Assembly, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    assembly.name.toLowerCase().includes(q) ||
    (assembly.sku ?? "").toLowerCase().includes(q) ||
    (assembly.tags ?? []).some((t) => t.toLowerCase().includes(q))
  );
}

const selectClass =
  "h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const GROUP_SORT_KEY = "unistock.assemblies.group_sort";

// グループでまとめる表示がオンのとき用の並び順。グループ→名前の順にし、
// グループ未設定(空文字列扱い)の中間品は末尾にまとめる(PartListPage.tsxと同じ方式)
function compareByGroupThenName(a: Assembly, b: Assembly): number {
  const groupA = a.group ?? "";
  const groupB = b.group ?? "";
  if (groupA !== groupB) {
    if (groupA === "") return 1;
    if (groupB === "") return -1;
    return groupA.localeCompare(groupB, "ja");
  }
  return a.name.localeCompare(b.name, "ja");
}

export default function AssemblyListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [groupSort, setGroupSort] = useState(() => readStoredToggle(GROUP_SORT_KEY, false));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [assemblyToDelete, setAssemblyToDelete] = useState<Assembly | null>(null);
  const [assemblyToBuild, setAssemblyToBuild] = useState<Assembly | null>(null);
  const [buildQuantity, setBuildQuantity] = useState(1);
  const [buildNote, setBuildNote] = useState("");
  const [reservationsTarget, setReservationsTarget] = useState<{ id: number; name: string } | null>(null);
  const lookupReservation = useReservationLookup(fetchAssemblyReservations);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const buildFeedback = useSaveFeedback();

  const { data, isLoading, error } = useQuery({
    queryKey: ["assemblies"],
    queryFn: fetchAssemblies,
  });
  const costsQuery = useQuery({
    queryKey: ["assemblies", "costs"],
    queryFn: fetchAssembliesCosts,
  });
  const costById = new Map((costsQuery.data ?? []).map((c) => [c.id, c.cost]));
  const buildableQuery = useQuery({
    queryKey: ["assemblies", "buildable-available"],
    queryFn: fetchAssembliesBuildableAvailable,
  });
  const buildableById = new Map((buildableQuery.data ?? []).map((b) => [b.id, b.available]));

  const deleteMutation = useMutation({
    mutationFn: deleteAssembly,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      setAssemblyToDelete(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: importAssembliesCsv,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assemblies"] }),
  });

  const buildMutation = useMutation({
    mutationFn: () => {
      if (!assemblyToBuild) throw new Error("中間品が選択されていません");
      return buildAssembly(assemblyToBuild.id, { quantity: buildQuantity, note: buildNote || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      queryClient.invalidateQueries({ queryKey: ["parts"] });
      buildFeedback.succeed("build");
      // 組立完了のチェック表示を一瞬見せてからダイアログを閉じる
      setTimeout(() => {
        setAssemblyToBuild(null);
        setBuildQuantity(1);
        setBuildNote("");
      }, 500);
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportAssembliesCsv,
  });

  function openBuildDialog(a: Assembly) {
    setAssemblyToBuild(a);
    setBuildQuantity(1);
    setBuildNote("");
    buildMutation.reset();
  }

  function handleBuildSubmit(e: FormEvent) {
    e.preventDefault();
    buildMutation.mutate();
  }

  const groups = useMemo(
    () => [...new Set((data ?? []).map((a) => a.group).filter((g): g is string => !!g))].sort(),
    [data]
  );

  const filtered = (data ?? []).filter(
    (a) => matchesSearch(a, search) && (!groupFilter || a.group === groupFilter)
  );
  const sorted = groupSort ? [...filtered].sort(compareByGroupThenName) : filtered;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, groupFilter, pageSize]);

  function handleGroupSortChange(checked: boolean) {
    setGroupSort(checked);
    writeStoredToggle(GROUP_SORT_KEY, checked);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = "";
  }

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">中間品</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            部品を組み立てて作る中間品(半製品)の在庫・組成を管理します
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button variant="outline" onClick={handleImportClick} disabled={importMutation.isPending}>
            {importMutation.isPending ? "インポート中..." : "インポート"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? "エクスポート中..." : "エクスポート"}
          </Button>
          <Link to="/assemblies/new" className={buttonVariants({ variant: "default" })}>
            新規作成
          </Link>
        </div>
      </div>
      <FieldError message={exportMutation.error ? (exportMutation.error as Error).message : null} />

      {importMutation.data && (
        <div className="mb-4 rounded-lg bg-muted px-4 py-3 text-sm">
          インポート結果: 新規{importMutation.data.created}件・更新{importMutation.data.updated}件
          {importMutation.data.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-destructive">
              {importMutation.data.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {importMutation.error && (
        <p className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(importMutation.error as Error).message}
        </p>
      )}

      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="assembly-search">検索</Label>
          <Input
            id="assembly-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="名前・SKU・タグで検索"
            className="w-64"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assembly-group-filter">グループ</Label>
          <select
            id="assembly-group-filter"
            className={selectClass}
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">全て</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Switch checked={groupSort} onCheckedChange={handleGroupSortChange} />
          グループでまとめる
        </label>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && (!data || data.length === 0) && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              中間品はまだありません。右上の「新規作成」から登録してください。
            </p>
          )}
          {!isLoading && !error && data && data.length > 0 && filtered.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">検索条件に一致する中間品がありません。</p>
          )}

          {!isLoading && !error && filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>SKU</TableHead>
                  {!groupSort && <TableHead>グループ</TableHead>}
                  <TableHead className="w-28 text-center">利用可能</TableHead>
                  <TableHead className="w-28 text-center">作成可能数</TableHead>
                  <TableHead className="w-28 text-center">原価</TableHead>
                  <TableHead className="sticky right-0 bg-muted px-2 last:pr-2"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((a, i) => {
                  const showGroupHeader = groupSort && (i === 0 || a.group !== paged[i - 1].group);
                  return (
                  <Fragment key={a.id}>
                    {showGroupHeader && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={groupSort ? 6 : 7}
                          className="bg-muted py-2.5 text-sm font-semibold text-foreground"
                        >
                          {a.group || "グループ未設定"}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow
                    className="cursor-pointer"
                    onClick={() => navigate(`/assemblies/${a.id}/edit`)}
                  >
                    <TableCell>
                      <div className={cn("flex flex-col gap-1", groupSort && "pl-4")}>
                        <span>{a.name}</span>
                        {(a.tags ?? []).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            {(a.tags ?? []).map((t) => (
                              <TagBadge key={t} tag={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.sku ?? <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    {!groupSort && (
                      <TableCell>
                        {a.group ? <GroupChip group={a.group} /> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex h-full items-center justify-end gap-2">
                        <Hint label={a.reserved > 0 ? `在庫${formatNumber(a.stock)} - 引当${formatNumber(a.reserved)}` : null}>
                          <span
                            className={cn(
                              "min-w-8 shrink-0 text-right tabular-nums font-medium",
                              a.available < 0 && "text-destructive"
                            )}
                          >
                            {formatNumber(a.available)}
                          </span>
                        </Hint>
                        {a.reserved > 0 && (
                          <Badge
                            className="h-4 shrink-0 cursor-pointer self-start border-transparent bg-blue-100 px-1.5 text-[10px] leading-none text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                            onClick={(e) => {
                              e.stopPropagation();
                              lookupReservation({ id: a.id, name: a.name }, setReservationsTarget);
                            }}
                          >
                            引当{formatNumber(a.reserved)}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {buildableById.has(a.id) && (
                        <span
                          className={cn(
                            (buildableById.get(a.id) ?? 0) <= 0 && "font-semibold text-destructive"
                          )}
                        >
                          {formatNumber(buildableById.get(a.id) ?? 0)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Hint
                        label={
                          a.unit_cost
                            ? `部品原価合計 ¥${formatNumber(
                                (costById.get(a.id) ?? 0) - a.unit_cost
                              )} + 追加費用 ¥${formatNumber(a.unit_cost)}`
                            : null
                        }
                      >
                        <span>¥{formatNumber(costById.get(a.id) ?? 0)}</span>
                      </Hint>
                    </TableCell>
                    <TableCell
                      className="sticky right-0 whitespace-nowrap bg-card px-2 last:pr-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" onClick={() => openBuildDialog(a)}>
                          組み立てる
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                            aria-label="その他の操作"
                          >
                            <MoreVertical />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => navigate(`/assemblies/new?duplicate=${a.id}`)}>
                              複製して新規作成
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setAssemblyToDelete(a)}>
                              削除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>

      <Dialog open={!!assemblyToDelete} onOpenChange={(open) => !open && setAssemblyToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>中間品を削除しますか？</DialogTitle>
            <DialogDescription>
              「{assemblyToDelete?.name}」を削除します。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(deleteMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssemblyToDelete(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => assemblyToDelete && deleteMutation.mutate(assemblyToDelete.id)}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assemblyToBuild} onOpenChange={(open) => !open && setAssemblyToBuild(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{assemblyToBuild?.name}」を組み立てる</DialogTitle>
            <DialogDescription>
              レシピの材料(部品・中間品)の在庫を消費して、この中間品の在庫を増やします。
            </DialogDescription>
          </DialogHeader>
          <form id="build-form" onSubmit={handleBuildSubmit} onKeyDown={preventEnterSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="build-quantity">数量</Label>
              <NumberInput
                id="build-quantity"
                value={String(buildQuantity)}
                onChange={(v) => setBuildQuantity(Number(v))}
                className="w-32 text-right"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="build-note">メモ</Label>
              <Input
                id="build-note"
                value={buildNote}
                onChange={(e) => setBuildNote(e.target.value)}
              />
            </div>
          </form>
          {buildMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(buildMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssemblyToBuild(null)}>
              キャンセル
            </Button>
            <Button type="submit" form="build-form" disabled={buildMutation.isPending}>
              {buildFeedback.isFlashing("build") ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-4" />
                  組み立てました
                </span>
              ) : buildMutation.isPending ? (
                "組立中..."
              ) : (
                "組み立てる"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReservingOrdersDialog
        target={reservationsTarget}
        onClose={() => setReservationsTarget(null)}
        fetchReservations={fetchAssemblyReservations}
      />
    </div>
  );
}
