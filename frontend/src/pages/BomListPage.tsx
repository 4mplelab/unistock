import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, MoreVertical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  exportBomCsv,
  fetchAssemblies,
  fetchAssembliesBuildableAvailable,
  fetchAssemblyRecipe,
  fetchBomProducts,
  fetchParts,
  importBomCsv,
  replaceBomForItem,
} from "../api/client";
import type { BomComponentType, BomCondition, BomItem } from "../types/bom";
import type { AssemblyItem, MaterialType } from "../types/assembly";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import Pagination, { usePageSize } from "../components/Pagination";
import { formatNumber } from "@/lib/format";
import { printWithTitle, todayStamp } from "@/lib/printWithTitle";
import AssemblyMark from "@/components/AssemblyMark";
import NoPartsNeededMark from "@/components/NoPartsNeededMark";
import ComponentLabel from "@/components/ComponentLabel";
import Hint from "@/components/Hint";
import FieldError from "@/components/FieldError";
import { useShopContext } from "@/contexts/ShopContext";
import { useBaseItemAdminUrl, useBaseItemShopUrl } from "@/lib/baseItemUrl";
import { hasPlatformSibling } from "@/lib/platforms";

interface BomGroupLine {
  component_type: BomComponentType;
  component_name: string;
  part_id: number | null;
  assembly_id: number | null;
  quantity: number;
  conditions: BomCondition[];
}

interface BomGroup {
  item_id: string;
  item_name: string | null;
  lines: BomGroupLine[];
}

interface ChoiceGroup {
  name: string;
  lines: BomGroupLine[];
}

interface OptionGroup {
  name: string;
  choices: ChoiceGroup[];
}

interface ComboGroup {
  name: string;
  lines: BomGroupLine[];
}

const UNORDERED = Number.MAX_SAFE_INTEGER;

// BomEditPageの「組み合わせ」カードは(オプションと違い)商品につき1つしか無いための
// 固定キー。編集ページ側の同名定数と対応させる
const COMBO_HIGHLIGHT_KEY = "__combo__";

function bomEditUrl(shopId: number, itemId: string, highlightOption?: string): string {
  const query = highlightOption ? `?highlight_option=${encodeURIComponent(highlightOption)}` : "";
  return `/bom/${shopId}/${encodeURIComponent(itemId)}/edit${query}`;
}

// 「種類」(バリエーション)は常に先頭グループとして扱う
function conditionGroupOrder(c: BomCondition): number {
  if (c.selector_type === "variation") return -1;
  return c.group_order ?? UNORDERED;
}

function splitLines(
  lines: BomGroupLine[]
): { common: BomGroupLine[]; options: OptionGroup[]; combos: ComboGroup[] } {
  const common: BomGroupLine[] = [];
  const optionMap = new Map<
    string,
    { order: number; choiceMap: Map<string, { order: number; lines: BomGroupLine[] }> }
  >();
  const comboMap = new Map<string, { order: number; lines: BomGroupLine[] }>();

  for (const l of lines) {
    if (l.conditions.length === 0) {
      common.push(l);
      continue;
    }

    if (l.conditions.length === 1) {
      const c = l.conditions[0];
      const groupName = c.group_name ?? "?";
      const choiceName = c.choice_name ?? "?";
      const groupOrder = conditionGroupOrder(c);
      const choiceOrder = c.choice_order ?? UNORDERED;
      if (!optionMap.has(groupName)) {
        optionMap.set(groupName, { order: groupOrder, choiceMap: new Map() });
      }
      const opt = optionMap.get(groupName)!;
      opt.order = Math.min(opt.order, groupOrder);
      if (!opt.choiceMap.has(choiceName)) {
        opt.choiceMap.set(choiceName, { order: choiceOrder, lines: [] });
      }
      const choice = opt.choiceMap.get(choiceName)!;
      choice.order = Math.min(choice.order, choiceOrder);
      choice.lines.push(l);
      continue;
    }

    // 2条件以上(組み合わせ条件): 全条件を「グループ名: 選択肢名」で連結した1つの見出しにまとめる
    const sorted = [...l.conditions].sort((a, b) => conditionGroupOrder(a) - conditionGroupOrder(b));
    const name = sorted.map((c) => `${c.group_name ?? "?"}: ${c.choice_name ?? "?"}`).join(" × ");
    const order = Math.min(...sorted.map(conditionGroupOrder));
    if (!comboMap.has(name)) {
      comboMap.set(name, { order, lines: [] });
    }
    const combo = comboMap.get(name)!;
    combo.order = Math.min(combo.order, order);
    combo.lines.push(l);
  }

  const options: OptionGroup[] = [...optionMap.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, opt]) => ({
      name,
      choices: [...opt.choiceMap.entries()]
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([choiceName, choice]) => ({ name: choiceName, lines: choice.lines })),
    }));

  const combos: ComboGroup[] = [...comboMap.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, combo]) => ({ name, lines: combo.lines }));

  return { common, options, combos };
}

// 中間品のレシピを展開表示するかどうかの丸ごとの状態管理・小さなトグルボタンの共通見た目。
// 中間品のIDをキーにするため、同じ中間品は画面のどこに出てきても展開状態を共有する
// (個別行ごとに独立させると、同じ中間品があちこちで開いたり閉じたりバラバラになり紛らわしい)
// 展開トグルの有無に関わらず、名前の開始位置が揃うよう常に同じ幅のスロットを確保する
// (中間品にだけアイコンが付くと部品行とテキストの開始位置がズレて見えるため、
// 中間品でない/レシピが無い行にも同じ幅の透明なスペーサーを入れる)
function IconSlot({ expanded, onToggle }: { expanded: boolean; onToggle: (() => void) | null }) {
  if (!onToggle) {
    return <span className="mr-0.5 inline-block size-4 shrink-0 align-[-3px] print:hidden" />;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="mr-0.5 inline-flex size-4 shrink-0 items-center justify-center align-[-3px] text-muted-foreground-subtle hover:text-foreground print:hidden"
      aria-label={expanded ? "折りたたむ" : "展開する"}
    >
      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  );
}

// 中間品の中身(さらに部品/中間品からなるレシピ)を再帰的にたどって表示する。
// 「商品→中間品→部品」がぱっと見で分かるようにしてほしいというフィードバックを受けて
// 追加した(以前は中間品名までしか表示せず、その先の構成を見るには編集画面を
// 別途開く必要があった)。既定は折りたたみで、中間品名の左のトグルをクリックすると
// その場で展開する(印刷時は常に全展開して見せる)
function RecipeTree({
  materialType,
  materialId,
  materialName,
  quantity,
  depth,
  recipeByAssemblyId,
  assembliesById,
  expandedAssemblyIds,
  onToggle,
}: {
  materialType: MaterialType;
  materialId: number;
  materialName: string;
  quantity: number;
  depth: number;
  recipeByAssemblyId: Map<number, AssemblyItem[]>;
  assembliesById: Map<number, { group: string | null }>;
  expandedAssemblyIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const recipe = materialType === "assembly" ? recipeByAssemblyId.get(materialId) : undefined;
  const hasRecipe = !!recipe && recipe.length > 0;
  const expanded = hasRecipe && expandedAssemblyIds.has(materialId);
  return (
    <div style={{ marginLeft: depth > 1 ? 16 : 0 }}>
      <IconSlot expanded={expanded} onToggle={hasRecipe ? () => onToggle(materialId) : null} />
      <Link
        to={materialType === "part" ? `/parts/${materialId}/edit` : `/assemblies/${materialId}/edit`}
        className="underline-offset-2 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {materialType === "assembly" ? (
          <AssemblyMark group={assembliesById.get(materialId)?.group}>{materialName}</AssemblyMark>
        ) : (
          materialName
        )}
      </Link>
      <span className="ml-2 text-muted-foreground-subtle">× {formatNumber(quantity)}</span>
      {hasRecipe && (
        <div className={cn("mt-0.5 grid gap-0.5 border-l border-border/60 pl-3 print:grid!", !expanded && "hidden")}>
          {recipe!.map((r) => (
            <RecipeTree
              key={`${r.material_type}-${r.material_id}`}
              materialType={r.material_type}
              materialId={r.material_id}
              materialName={r.material_name}
              quantity={r.quantity}
              depth={depth + 1}
              recipeByAssemblyId={recipeByAssemblyId}
              assembliesById={assembliesById}
              expandedAssemblyIds={expandedAssemblyIds}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BomLineDisplay({
  line,
  partsById,
  assembliesById,
  recipeByAssemblyId,
  expandedAssemblyIds,
  onToggle,
}: {
  line: BomGroupLine;
  partsById: Map<number, { group: string | null; colors: string[] | null; tags: string[] | null }>;
  assembliesById: Map<number, { group: string | null }>;
  recipeByAssemblyId: Map<number, AssemblyItem[]>;
  expandedAssemblyIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  if (line.component_type === "none") return <NoPartsNeededMark />;
  if (line.component_type === "assembly") {
    const recipe = line.assembly_id != null ? recipeByAssemblyId.get(line.assembly_id) : undefined;
    const hasRecipe = !!recipe && recipe.length > 0;
    const expanded = hasRecipe && expandedAssemblyIds.has(line.assembly_id!);
    return (
      <div>
        <IconSlot expanded={expanded} onToggle={hasRecipe ? () => onToggle(line.assembly_id!) : null} />
        <Link
          to={`/assemblies/${line.assembly_id}/edit`}
          className="underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <AssemblyMark group={line.assembly_id != null ? assembliesById.get(line.assembly_id)?.group : null}>
            {line.component_name}
          </AssemblyMark>
        </Link>
        <span className="ml-2">× {formatNumber(line.quantity)}</span>
        {hasRecipe && (
          <div
            className={cn(
              "mt-0.5 grid gap-0.5 border-l border-border/60 pl-3 text-muted-foreground-subtle print:grid!",
              !expanded && "hidden"
            )}
          >
            {recipe!.map((r) => (
              <RecipeTree
                key={`${r.material_type}-${r.material_id}`}
                materialType={r.material_type}
                materialId={r.material_id}
                materialName={r.material_name}
                quantity={r.quantity}
                depth={1}
                recipeByAssemblyId={recipeByAssemblyId}
                assembliesById={assembliesById}
                expandedAssemblyIds={expandedAssemblyIds}
                onToggle={onToggle}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  const part = line.part_id != null ? partsById.get(line.part_id) : undefined;
  return (
    <>
      <IconSlot expanded={false} onToggle={null} />
      <Link
        to={`/parts/${line.part_id}/edit`}
        className="group text-primary underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        <ComponentLabel name={line.component_name} group={part?.group} colors={part?.colors} tags={part?.tags} />
      </Link>
      <span className="ml-2">× {line.quantity}</span>
    </>
  );
}

// 商品名は商品ページ(お客様向け、ショップごとのドメインなので常に一意)、商品IDは
// 商品編集ページ(管理画面)を、それぞれ別タブで開く。ショップ設定でURLテンプレートが
// 未設定ならリンクにせずプレーンテキストで表示する(プラットフォーム問わず)。
// 管理画面は同一プラットフォームの他ショップがあると「今ログインしているのがどの
// ショップか」を区別できないため、その場合もリンクにしない
function BomItemLink({
  shopId,
  itemId,
  itemName,
}: {
  shopId: number;
  itemId: string;
  itemName: string | null;
}) {
  const { shops } = useShopContext();
  const shopUrl = useBaseItemShopUrl(shopId, itemId);
  const adminUrl = useBaseItemAdminUrl(shopId, itemId);
  const adminAmbiguous = hasPlatformSibling(shops, shopId);
  return (
    <div className="grid gap-0.5">
      {shopUrl ? (
        <Hint label="商品ページを開く">
          <a
            href={shopUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="group inline-flex w-fit items-center gap-1 underline-offset-2"
          >
            <span className="text-sm font-semibold text-primary group-hover:underline">
              {itemName ?? <span className="text-muted-foreground">-</span>}
            </span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground-subtle" />
          </a>
        </Hint>
      ) : (
        <span className="text-sm font-semibold">{itemName ?? <span className="text-muted-foreground">-</span>}</span>
      )}
      {adminUrl && !adminAmbiguous ? (
        <Hint label="商品編集ページを開く">
          <a
            href={adminUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="group inline-flex w-fit items-center gap-1 underline-offset-2"
          >
            <span className="font-mono text-xs text-muted-foreground group-hover:underline">{itemId}</span>
            <ExternalLink className="size-2.5 shrink-0 text-muted-foreground-subtle" />
          </a>
        </Hint>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">{itemId}</span>
      )}
    </div>
  );
}

// 渡された行の集合から、今の部品/中間品在庫であと何個作成できるかを算出する。
// 「共通」「オプションの選択肢1つ分」「組み合わせの1マス分」など、実際に同時に
// 必要になる行の集合ごとに個別に呼び出す(選択肢が違えば使う部品も別なので、
// 商品全体を1つの数字にまとめて合算しない)。レシピが1行も無い場合(=lines.length===0)は
// 算出不能としてnullを返し、呼び出し側は表示自体を省略する。
// 中間品は在庫(available)だけでなく、材料からさらに追加で組み立てられる分も
// 含めた数(assemblyBuildableById、多段構成もバックエンド側で再帰的に展開済み)を使う。
// マイナスは「不足」以上の意味を持たず読み手が混乱するだけなので、最終的に0で切り捨てる
function computeBuildableCount(
  lines: BomGroupLine[],
  partsById: Map<number, { available: number }>,
  assemblyBuildableById: Map<number, number>
): number | null {
  if (lines.length === 0) return null;
  let min: number | null = null;
  for (const l of lines) {
    if (l.component_type === "none") continue;
    const available =
      l.component_type === "part" ? partsById.get(l.part_id!)?.available : assemblyBuildableById.get(l.assembly_id!);
    if (available == null) continue;
    const buildable = Math.floor(available / l.quantity);
    min = min === null ? buildable : Math.min(min, buildable);
  }
  return min === null ? null : Math.max(0, min);
}

function BuildableCount({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className={cn("tabular-nums", value <= 0 && "font-semibold text-destructive")}>{value}</span>
  );
}

function groupByItem(data: BomItem[]): BomGroup[] {
  const map = new Map<string, BomGroup>();
  for (const b of data) {
    if (!map.has(b.item_id)) {
      map.set(b.item_id, { item_id: b.item_id, item_name: b.item_name, lines: [] });
    }
    map.get(b.item_id)!.lines.push({
      component_type: b.component_type,
      component_name: b.component_name,
      part_id: b.part_id,
      assembly_id: b.assembly_id,
      quantity: b.quantity,
      conditions: b.conditions,
    });
  }
  return Array.from(map.values());
}

export default function BomListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentShopId: shopId, currentShop, shops } = useShopContext();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [itemToDelete, setItemToDelete] = useState<{ item_id: string; item_name: string | null } | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (item: { item_id: string; item_name: string | null }) =>
      replaceBomForItem(shopId!, item.item_id, { item_name: item.item_name, lines: [] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bom-products"] });
      queryClient.invalidateQueries({ queryKey: ["bom"] });
      setItemToDelete(null);
    },
  });

  // BOMは商品×条件組み合わせ×部品のデカルト積で増え続けるため全件取得はせず、
  // 商品(item_id)単位でサーバー側にlimit/offset+検索条件を渡してページ単位を取得する。
  // 検索は自由テキスト1項目のみ(複数条件のANDではない)なので、他の一覧と同様に
  // リアルタイムのままとし、打鍵のたびに問い合わせが飛ばないようデバウンスだけ挟む
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["bom-products", shopId, search, page, pageSize],
    queryFn: () => fetchBomProducts(shopId!, search, pageSize, (page - 1) * pageSize),
    enabled: shopId != null,
  });

  // BOM行が参照する部品のグループ・カラーの表示、および作成可能数の算出のため、
  // 部品一覧・中間品の作成可能数を別途取得して引く
  const partsQuery = useQuery({ queryKey: ["parts"], queryFn: fetchParts });
  const partsById = new Map((partsQuery.data ?? []).map((p) => [p.id, p]));
  const assemblyBuildableQuery = useQuery({
    queryKey: ["assemblies", "buildable-available"],
    queryFn: fetchAssembliesBuildableAvailable,
  });
  const assemblyBuildableById = new Map((assemblyBuildableQuery.data ?? []).map((a) => [a.id, a.available]));

  // 中間品を1階層先まで(商品→中間品→部品)展開表示するため、全中間品のレシピを
  // まとめて取得しておく(中間品の総数は少ない想定なので、表示中の行に限定せず
  // 一括で取得する。assembly-recipeのqueryKeyは中間品編集画面と共通なのでキャッシュも効く)
  const assembliesQuery = useQuery({ queryKey: ["assemblies"], queryFn: fetchAssemblies });
  const allAssemblies = assembliesQuery.data ?? [];
  const assembliesById = new Map(allAssemblies.map((a) => [a.id, a]));
  const recipeQueries = useQueries({
    queries: allAssemblies.map((a) => ({
      queryKey: ["assembly-recipe", a.id],
      queryFn: () => fetchAssemblyRecipe(a.id),
    })),
  });
  const recipeByAssemblyId = new Map<number, AssemblyItem[]>();
  allAssemblies.forEach((a, i) => {
    const recipeData = recipeQueries[i]?.data;
    if (recipeData) recipeByAssemblyId.set(a.id, recipeData);
  });

  // 中間品のレシピ展開の開閉状態。既定は全て折りたたみ(空集合)。中間品IDをキーに
  // 管理するため、同じ中間品はページのどこに出てきても開閉が連動する
  const [expandedAssemblyIds, setExpandedAssemblyIds] = useState<Set<number>>(new Set());
  function toggleExpanded(id: number) {
    setExpandedAssemblyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const expandableAssemblyIds = allAssemblies.filter((a) => (recipeByAssemblyId.get(a.id)?.length ?? 0) > 0).map((a) => a.id);
  const allExpanded = expandableAssemblyIds.length > 0 && expandableAssemblyIds.every((id) => expandedAssemblyIds.has(id));

  // オプショングループ(右モジュール等)ごとの折りたたみ状態。既定は展開(空集合=何も
  // 畳んでいない)。中間品と違い商品ごとに無関係なグループなので、item_id+グループ名を
  // キーにする(同名オプションが別商品にあっても連動させない)
  const [collapsedOptionKeys, setCollapsedOptionKeys] = useState<Set<string>>(new Set());
  function toggleOptionCollapsed(key: string) {
    setCollapsedOptionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const importMutation = useMutation({
    mutationFn: (file: File) => importBomCsv(shopId!, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bom-products"] }),
  });

  const exportMutation = useMutation({
    mutationFn: () => exportBomCsv(shopId!),
  });

  const groups = groupByItem(data?.items ?? []);
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, shopId]);

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
          <h1 className="text-3xl font-semibold tracking-tight">BOM(商品レシピ)</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            {currentShop ? `${currentShop.name}の商品が消費する部品と数量を管理します` : "商品が消費する部品と数量を管理します"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            variant="outline"
            onClick={() => printWithTitle(`BOM構成_${todayStamp()}`)}
          >
            PDF出力
          </Button>
          <Button
            variant="outline"
            onClick={handleImportClick}
            disabled={importMutation.isPending || shopId == null}
          >
            {importMutation.isPending ? "インポート中..." : "インポート"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={shopId == null || exportMutation.isPending}
          >
            {exportMutation.isPending ? "エクスポート中..." : "エクスポート"}
          </Button>
          <Link
            to={shopId != null ? `/bom/${shopId}/new` : "#"}
            className={buttonVariants({ variant: "default" })}
            aria-disabled={shopId == null}
          >
            新規作成
          </Link>
        </div>
      </div>
      <div className="print:hidden">
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
      </div>

      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="商品名・商品ID・部品名で検索"
          className="max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={allExpanded}
            onCheckedChange={(checked) =>
              setExpandedAssemblyIds(checked ? new Set(expandableAssemblyIds) : new Set())
            }
            disabled={expandableAssemblyIds.length === 0}
          />
          中間品の内訳を展開
        </label>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {shops.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              ショップがまだありません。ヘッダーの切り替えメニューか設定画面からショップを追加してください。
            </p>
          )}
          {shops.length > 0 && isLoading && (
            <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>
          )}
          {error && (
            <p className="py-12 text-center text-sm text-destructive">
              読み込みに失敗しました: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && data && groups.length === 0 && !search && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              BOMはまだありません。右上の「新規作成」から登録してください。
            </p>
          )}
          {!isLoading && !error && data && groups.length === 0 && search && (
            <p className="py-12 text-center text-sm text-muted-foreground">検索条件に一致するBOMがありません。</p>
          )}

          {!isLoading && !error && groups.length > 0 && (
            // table-layout:fixedで列幅を固定し、常にCSS側で指定した比率通りになるようにする。
            // auto(内容依存の可変幅)だと、オプション行(colSpan=2)の内部グリッドの幅と実際の
            // 列幅を一致させる方法が実測しか無く、実測はフォント読み込みタイミング等で
            // 環境によって結果が変わり不安定だった。min-wを設けているのは、画面が狭い時に
            // 列を無理に縮めるのではなく横スクロールさせるため(Tableコンポーネントが
            // ラップしているoverflow-x-autoコンテナで自動的にスクロール可能になる)
            <Table className="table-fixed min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42%]">商品</TableHead>
                  <TableHead>部品/中間品</TableHead>
                  <TableHead className="w-28 text-right">作成可能数</TableHead>
                  <TableHead className="sticky right-0 w-10 bg-muted px-2 last:pr-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const { common, options, combos } = splitLines(g.lines);
                  const goToEdit = () => navigate(bomEditUrl(shopId!, g.item_id));
                  const hasCombos = combos.length > 0;
                  const lastOptionIndex = options.length - 1;

                  // オプション/組み合わせは「選択肢ごとに行を分ける」のをやめ、1オプション=1行に
                  // まとめた(選択肢名と部品リストはセル内のCSS Gridで並べる)。これにより、
                  // グループを貫く縦バーは1セルに1本描くだけで済み、複数行にまたがる高さ計算や
                  // 行間の途切れを気にする必要が無くなる
                  const groupBar = "absolute top-3 bottom-2 left-10 w-1 rounded-full bg-[linear-gradient(to_bottom,transparent,color-mix(in_oklab,var(--color-muted-foreground)_55%,transparent),transparent)]";
                  // 1列目の幅は、外側tableの1列目(w-[42%]、TableHead参照)の実際のテキスト開始位置
                  // (ヘッダーのpx-4パディング込み)と、このグリッド2列目のテキスト開始位置が
                  // 揃うよう計算した値。このセルはcolSpan={3}でfirst+last扱いのためpl-6+pr-6を
                  // 持つが、外側の2列目自体はpl-4しか持たないため、その差分とgrid間の
                  // gap(16px)を定数(+5px)で補正している(この定数はパディング差分に由来する
                  // 固定px値のため、1列目の%を変えても変わらない)。3列目(作成可能数)は
                  // 外側と同じ固定幅(w-28=112px)をそのまま使う。両者とも「セルの右端に接する
                  // 固定幅の最終列」という同じ構造のため、追加の補正無しで右端が一致する
                  const groupGrid = "mt-1.5 grid grid-cols-[calc(42%_+_5px)_minmax(0,1fr)_112px] gap-x-4 gap-y-2";

                  const commonBuildable = computeBuildableCount(common, partsById, assemblyBuildableById);
                  const groupRowCount = 1 + options.length + (hasCombos ? 1 : 0);

                  return (
                    <Fragment key={g.item_id}>
                      <TableRow
                        className={cn("cursor-pointer", (options.length > 0 || hasCombos) && "border-b-0")}
                        onClick={goToEdit}
                      >
                        <TableCell className="py-4 align-top">
                          <BomItemLink shopId={shopId!} itemId={g.item_id} itemName={g.item_name} />
                        </TableCell>
                        <TableCell className="whitespace-normal py-4 align-top">
                          {common.length > 0 ? (
                            <ul className="flex flex-col gap-0.5 text-xs leading-relaxed">
                              {common.map((l, i2) => (
                                <li key={i2}><BomLineDisplay line={l} partsById={partsById} assembliesById={assembliesById} recipeByAssemblyId={recipeByAssemblyId} expandedAssemblyIds={expandedAssemblyIds} onToggle={toggleExpanded} /></li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-4 text-right align-top text-sm">
                          <BuildableCount value={commonBuildable} />
                        </TableCell>
                        <TableCell
                          rowSpan={groupRowCount}
                          className="sticky right-0 bg-card px-2 align-top last:pr-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                              aria-label="その他の操作"
                            >
                              <MoreVertical />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                onClick={() =>
                                  navigate(`/bom/${shopId}/new?duplicate_item_id=${encodeURIComponent(g.item_id)}`)
                                }
                              >
                                複製して新規作成
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setItemToDelete({ item_id: g.item_id, item_name: g.item_name })}
                              >
                                削除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>

                      {options.map((opt, optIndex) => {
                        const optionKey = `${g.item_id}:${opt.name}`;
                        const collapsed = collapsedOptionKeys.has(optionKey);
                        return (
                          <TableRow
                            key={`option-${opt.name}`}
                            className={cn("cursor-pointer", (optIndex !== lastOptionIndex || hasCombos) && "border-b-0")}
                            onClick={() => navigate(bomEditUrl(shopId!, g.item_id, opt.name))}
                          >
                            <TableCell colSpan={3} className="relative whitespace-normal py-3">
                              <div className={groupBar} />
                              <div className="pl-8 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleOptionCollapsed(optionKey);
                                  }}
                                  className="inline-flex size-3.5 shrink-0 items-center justify-center normal-case text-muted-foreground-subtle hover:text-foreground print:hidden"
                                  aria-label={collapsed ? "展開する" : "折りたたむ"}
                                >
                                  {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                </button>
                                {opt.name}
                              </div>
                              <div className={cn(groupGrid, "print:grid!", collapsed && "hidden")}>
                                {opt.choices.map((choice) => (
                                  <Fragment key={choice.name}>
                                    <div className="pl-10 text-xs">{choice.name}</div>
                                    <ul className="flex flex-col gap-0.5 text-xs leading-relaxed">
                                      {choice.lines.map((l, i2) => (
                                        <li key={i2}><BomLineDisplay line={l} partsById={partsById} assembliesById={assembliesById} recipeByAssemblyId={recipeByAssemblyId} expandedAssemblyIds={expandedAssemblyIds} onToggle={toggleExpanded} /></li>
                                      ))}
                                    </ul>
                                    <div className="text-right text-xs">
                                      <BuildableCount
                                        value={computeBuildableCount(choice.lines, partsById, assemblyBuildableById)}
                                      />
                                    </div>
                                  </Fragment>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}

                      {hasCombos && (
                        // 組み合わせは軸×軸のマス目全てを一覧に出すと複雑になりすぎるため、
                        // 「設定がある」ことだけ分かる簡潔な表示に留め、詳細はBOM編集画面
                        // (クリックで遷移、COMBO_HIGHLIGHT_KEYでハイライト)で確認してもらう
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => navigate(bomEditUrl(shopId!, g.item_id, COMBO_HIGHLIGHT_KEY))}
                        >
                          <TableCell colSpan={3} className="relative whitespace-normal py-3">
                            <div className={groupBar} />
                            <div className="pl-8 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                              組み合わせ
                            </div>
                            <div className="pl-10 text-xs text-muted-foreground">
                              {combos.length}件の組み合わせが設定されています
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="print:hidden">
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={itemToDelete !== null} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>BOMを削除しますか？</DialogTitle>
            <DialogDescription>
              「{itemToDelete?.item_name ?? itemToDelete?.item_id}」の共通・オプション・種類・組み合わせを含む全ての行を削除します。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(deleteMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemToDelete(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete)}
            >
              {deleteMutation.isPending ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
