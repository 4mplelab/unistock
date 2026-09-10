import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createAssembly,
  fetchAssemblies,
  fetchAssembliesCosts,
  fetchBomItems,
  fetchBomProductSetting,
  fetchBomProducts,
  fetchItem,
  fetchItemOptions,
  fetchItemVariations,
  fetchParts,
  replaceBomForItem,
  updateBomProductSetting,
} from "../api/client";
import type { ItemOption, ItemVariation } from "../types/item";
import type { MaterialType } from "../types/assembly";
import type { BomComponentType, BomCondition } from "../types/bom";
import ComponentCombobox, { type ComponentOption } from "@/components/ComponentCombobox";
import ComponentLabel from "@/components/ComponentLabel";
import ItemCombobox, { type SelectedItem } from "@/components/ItemCombobox";
import AssemblyMark from "@/components/AssemblyMark";
import NoPartsNeededMark from "@/components/NoPartsNeededMark";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { MoreVertical, ArrowDown, ArrowRight } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Hint from "@/components/Hint";
import SaveFlashCheck from "@/components/SaveFlashCheck";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

// BOM一覧の「組み合わせ」行(商品につき1つ)から遷移してきたときのハイライト対象キー。
// 一覧側(BomListPage)の同名定数と対応させる
const COMBO_HIGHLIGHT_KEY = "__combo__";

function bomOptionCardId(key: string): string {
  return `bom-option-card-${encodeURIComponent(key)}`;
}

interface Line {
  component_type: BomComponentType;
  part_id: number | null;
  assembly_id: number | null;
  quantity: number;
  conditions: BomCondition[];
}

const UNORDERED = Number.MAX_SAFE_INTEGER;

function componentKey(componentType: BomComponentType, componentId: number | null): string {
  return `${componentType}:${componentId ?? ""}`;
}

// 条件の組み合わせを一意に表すキー(条件0件=共通行、条件1件=従来のオプション/種類単独行、
// 条件2件以上=組み合わせ行)。行の重複判定・React keyに使う。
function conditionsSignature(conditions: BomCondition[]): string {
  if (conditions.length === 0) return "common";
  return conditions
    .map((c) => `${c.selector_type}:${c.selector_id}`)
    .sort()
    .join("+");
}

function lineKey(line: Line): string {
  const id = line.component_type === "part" ? line.part_id : line.component_type === "assembly" ? line.assembly_id : null;
  return `${conditionsSignature(line.conditions)}:${componentKey(line.component_type, id)}`;
}

// BASEの並び順(choice_order)を保持する。複数条件の行は最小値を使う。未設定の行は末尾に回す。
function primaryChoiceOrder(line: Line): number {
  if (line.conditions.length === 0) return UNORDERED;
  return Math.min(...line.conditions.map((c) => c.choice_order ?? UNORDERED));
}

function byChoiceOrder(a: Line, b: Line): number {
  return primaryChoiceOrder(a) - primaryChoiceOrder(b);
}

function conditionsLabel(conditions: BomCondition[]): string {
  return conditions.map((c) => `${c.group_name ?? "?"}: ${c.choice_name ?? "?"}`).join(" × ");
}

// 「組み合わせ」セクションで選べる軸(オプショングループ + 種類)。BOM複製時のコピー元/
// コピー先の対応付けにも同じ形を使う(コピー元は実際のオプション/種類データから同様に構築する)
interface Axis {
  key: string;
  label: string;
  selectorType: "option" | "variation";
  groupOrder: number | null;
  choices: { id: string; name: string; order: number }[];
}

function buildAxes(optionGroups: ItemOption[], itemVariations: ItemVariation[]): Axis[] {
  return [
    ...optionGroups.map((g, gi) => ({
      key: `option:${g.option_id}`,
      label: g.option_name,
      selectorType: "option" as const,
      groupOrder: gi,
      choices: g.choices.map((c, ci) => ({ id: c.option_variation_id, name: c.variation_name, order: ci })),
    })),
    ...(itemVariations.length > 0
      ? [
          {
            key: "variation",
            label: "種類",
            selectorType: "variation" as const,
            groupOrder: null,
            choices: itemVariations.map((v, vi) => ({ id: v.variation_id, name: v.variation_name, order: vi })),
          },
        ]
      : []),
  ];
}

// BOMの複製元(duplicateItemId)側の軸は、その商品の「現在の」オプション/種類設定ではなく、
// 実際にコピー元のBOM行が参照している条件から組み立てる。商品側の選択肢構成は後から
// 変わりうる(既存の「不明なオプション」行と同じ理由)ため、コピーしたい対象そのもの
// (BOM行の条件)を正としたほうが、対応付けの候補として実態に即している
function buildAxesFromConditions(lines: { conditions: BomCondition[] }[]): Axis[] {
  const axisByKey = new Map<string, Axis>();
  for (const line of lines) {
    for (const c of line.conditions) {
      const key = `${c.selector_type}:${c.group_name ?? ""}`;
      let axis = axisByKey.get(key);
      if (!axis) {
        axis = {
          key,
          label: c.group_name ?? "?",
          selectorType: c.selector_type,
          groupOrder: c.group_order ?? null,
          choices: [],
        };
        axisByKey.set(key, axis);
      }
      if (!axis.choices.some((ch) => ch.name === c.choice_name)) {
        axis.choices.push({
          id: c.selector_id,
          name: c.choice_name ?? "?",
          order: c.choice_order ?? axis.choices.length,
        });
      }
    }
  }
  return [...axisByKey.values()];
}

interface OptionDraft {
  choiceId: string;
  componentType: BomComponentType;
  componentId: number | "";
  quantity: number;
}

const emptyOptionDraft: OptionDraft = { choiceId: "", componentType: "part", componentId: "", quantity: 1 };

export default function BomEditPage() {
  const { shopId: routeShopId, itemId: routeItemId } = useParams<{ shopId: string; itemId?: string }>();
  const shopId = Number(routeShopId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightOption = searchParams.get("highlight_option");
  const [flashOption, setFlashOption] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [seededForItemId, setSeededForItemId] = useState<string | null>(null);
  const [newComponentType, setNewComponentType] = useState<BomComponentType>("part");
  const [newComponentId, setNewComponentId] = useState<number | "">("");
  const [newQuantity, setNewQuantity] = useState(1);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, OptionDraft>>({});
  const [variationDraft, setVariationDraft] = useState<OptionDraft>(emptyOptionDraft);
  const [comboAxisAKey, setComboAxisAKey] = useState("");
  const [comboAxisBKey, setComboAxisBKey] = useState("");
  const [comboFixedChoices, setComboFixedChoices] = useState<Record<string, string>>({});
  // 組み合わせグリッドは1マスにつき1件だけ登録できる形だったが、「1マスに複数件登録したい」
  // というフィードバックを受け、共通/オプションと同じ「登録済み行のリスト+1行ずつ追加する
  // 小さいフォーム」の方式に変更した。今どのマスの追加フォームを開いているかだけを持つ
  // (同時に開けるのは1マスのみ。マスごとに状態を持つと管理が煩雑になるため)
  const [comboCellDraft, setComboCellDraft] = useState<{
    cellKey: string;
    componentType: BomComponentType;
    componentId: number | "";
    quantity: number;
  } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const blocker = useUnsavedChangesGuard(isDirty);

  // BOM行→中間品の変換(抽出)。選択した行(同じ条件の組み合わせのものだけ)をまとめて
  // 新しい中間品として作成し、そのBOM行を「中間品への参照1行」に置き換える。
  // activeScopeは「共通」「オプションのどのグループか」等、今どの1テーブルで選択中かを表す
  // (常時チェックボックスを出すと画面が煩雑になるため、選択モードに入ったテーブルにだけ出す)
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [extractDialogOpen, setExtractDialogOpen] = useState(false);
  const [extractName, setExtractName] = useState("");
  const [extractSku, setExtractSku] = useState("");
  // ボタンが未入力の間ずっと無効化されているため「送信を試みた」瞬間が無い。
  // 代わりに一度フォーカスを外した(=入力しようとした)ことをもって判定する
  const [extractNameTouched, setExtractNameTouched] = useState(false);

  useEffect(() => {
    if (extractDialogOpen) setExtractNameTouched(false);
  }, [extractDialogOpen]);

  function startSelecting(scope: string) {
    setActiveScope(scope);
    setSelectedKeys(new Set());
  }

  function cancelSelecting() {
    setActiveScope(null);
    setSelectedKeys(new Set());
  }

  const partsQuery = useQuery({ queryKey: ["parts"], queryFn: fetchParts });
  const assembliesQuery = useQuery({ queryKey: ["assemblies"], queryFn: fetchAssemblies });
  const assemblyCostsQuery = useQuery({ queryKey: ["assemblies", "costs"], queryFn: fetchAssembliesCosts });

  // URLにitemIdが含まれる(編集モード)場合、初回に連携先から商品名を引いてselectedItemを確定する
  const routeItemQuery = useQuery({
    queryKey: ["items", shopId, routeItemId],
    queryFn: () => fetchItem(shopId, routeItemId as string),
    enabled: !!routeItemId && !selectedItem,
  });

  useEffect(() => {
    if (routeItemId && routeItemQuery.data && !selectedItem) {
      setSelectedItem({ item_id: routeItemQuery.data.item_id, item_name: routeItemQuery.data.title });
    }
  }, [routeItemId, routeItemQuery.data, selectedItem]);

  const existingBomQuery = useQuery({
    queryKey: ["bom", shopId, selectedItem?.item_id],
    queryFn: () => fetchBomItems(shopId, selectedItem!.item_id),
    enabled: !!selectedItem,
  });

  // BOM一覧の「複製して新規作成」アイコン(?duplicate_item_id=)経由で来た場合のコピー元。
  // 新規作成画面でのみ意味を持つ(既存BOMの編集中に別商品の行を混ぜる操作は成立しないため)
  const duplicateItemId = !routeItemId ? searchParams.get("duplicate_item_id") : null;
  const [copyOffered, setCopyOffered] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const duplicateItemQuery = useQuery({
    queryKey: ["items", shopId, duplicateItemId],
    queryFn: () => fetchItem(shopId, duplicateItemId as string),
    enabled: !!duplicateItemId,
  });
  const duplicateBomQuery = useQuery({
    queryKey: ["bom", shopId, duplicateItemId],
    queryFn: () => fetchBomItems(shopId, duplicateItemId as string),
    enabled: !!duplicateItemId,
  });
  // 対象商品側でオプション/種類の名前が一致しない場合の手動対応付け。
  // key: コピー先の軸key、value: コピー元の軸key(未設定なら対応付けなし)
  const [axisMapping, setAxisMapping] = useState<Record<string, string>>({});
  // key: `${コピー先の軸key}:${コピー先の選択肢id}`、value: コピー元の選択肢id
  const [choiceMapping, setChoiceMapping] = useState<Record<string, string>>({});
  // 複製先の候補からは、複製元自身と、すでにBOMが登録済みの商品を除外する(複製は
  // 「まだBOMが無い商品を素早く用意する」ためのものなので、既存の構成を持つ商品に
  // 上書きで混ぜてしまう事故を避ける)
  const existingBomProductsQuery = useQuery({
    queryKey: ["bom-products", shopId, "__all_for_exclude__"],
    queryFn: () => fetchBomProducts(shopId, "", 1000, 0),
    enabled: !!duplicateItemId,
  });
  const duplicateExcludeItemIds = new Set<string>(
    duplicateItemId
      ? [duplicateItemId, ...(existingBomProductsQuery.data?.items.map((i) => i.item_id) ?? [])]
      : []
  );

  // 「PDF出力時にオプションを横並びの表にするか」(旧Excel版注文サマリの形式)。BOM行とは
  // 独立した商品単位の設定のため、押した瞬間に単独で保存する(BOM行の「保存」ボタンとは
  // 連動させない)
  const productSettingQuery = useQuery({
    queryKey: ["bom-product-setting", shopId, selectedItem?.item_id],
    queryFn: () => fetchBomProductSetting(shopId, selectedItem!.item_id),
    enabled: !!selectedItem,
  });
  const productSettingMutation = useMutation({
    mutationFn: ({ matrixLayout, buildableAlertThreshold }: { matrixLayout: boolean; buildableAlertThreshold: number | null }) =>
      updateBomProductSetting(shopId, selectedItem!.item_id, matrixLayout, buildableAlertThreshold),
    onSuccess: (data) => {
      queryClient.setQueryData(["bom-product-setting", shopId, selectedItem?.item_id], data);
    },
  });
  const productSettingFeedback = useSaveFeedback();

  // 作成可能数アラート閾値(通知機能用)。入力中は自由に打てるよう別状態にし、
  // blur時にmatrix_layoutの現在値と一緒に保存する(PUTは両フィールドまとめて更新する仕様のため)
  const savedBuildableAlertThreshold = productSettingQuery.data?.buildable_alert_threshold ?? null;
  const [buildableAlertThreshold, setBuildableAlertThreshold] = useState(
    savedBuildableAlertThreshold != null ? String(savedBuildableAlertThreshold) : ""
  );
  useEffect(() => {
    setBuildableAlertThreshold(savedBuildableAlertThreshold != null ? String(savedBuildableAlertThreshold) : "");
  }, [savedBuildableAlertThreshold]);

  const itemOptionsQuery = useQuery({
    queryKey: ["item-options", shopId, selectedItem?.item_id],
    queryFn: () => fetchItemOptions(shopId, selectedItem!.item_id),
    enabled: !!selectedItem,
  });

  const itemVariationsQuery = useQuery({
    queryKey: ["item-variations", shopId, selectedItem?.item_id],
    queryFn: () => fetchItemVariations(shopId, selectedItem!.item_id),
    enabled: !!selectedItem,
  });

  useEffect(() => {
    if (selectedItem && existingBomQuery.data && seededForItemId !== selectedItem.item_id) {
      setLines(
        existingBomQuery.data.map((r) => ({
          component_type: r.component_type,
          part_id: r.part_id,
          assembly_id: r.assembly_id,
          quantity: r.quantity,
          conditions: r.conditions,
        }))
      );
      setSeededForItemId(selectedItem.item_id);
    }
  }, [selectedItem, existingBomQuery.data, seededForItemId]);

  // シード完了時のlinesを基準値として記録し(この時点ではダーティにしない)、以後それと
  // 異なる内容になったら初めてダーティにする(linesの初期化とシードが別タイミングのため、
  // 単純に「初回だけ無視する」ガードだと区別できない)
  const linesBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedItem || seededForItemId !== selectedItem.item_id) return;
    const serialized = JSON.stringify(lines);
    if (linesBaselineRef.current === null) {
      linesBaselineRef.current = serialized;
      return;
    }
    if (serialized !== linesBaselineRef.current) {
      setIsDirty(true);
    }
  }, [lines, selectedItem, seededForItemId]);

  function handleItemChange(value: SelectedItem | null) {
    setSelectedItem(value);
    setLines([]);
    setSeededForItemId(null);
    setOptionDrafts({});
    setVariationDraft(emptyOptionDraft);
    setComboAxisAKey("");
    setComboAxisBKey("");
    setComboFixedChoices({});
    setComboCellDraft(null);
    // 商品の選び直しは「別のBOMを新たに編集し始める」操作のため、未保存扱いにはしない
    linesBaselineRef.current = null;
    setIsDirty(false);
    // 選び直した商品に対して改めて複製提案を出せるようにする
    setCopyOffered(false);
    setCopyDialogOpen(false);
    setAxisMapping({});
    setChoiceMapping({});
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedItem) throw new Error("商品が選択されていません");
      return replaceBomForItem(shopId, selectedItem.item_id, { item_name: selectedItem.item_name, lines });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bom"] });
      setIsDirty(false);
    },
  });

  // isDirtyがfalseになった再描画を経てからnavigateする(保存直後に同期的にnavigateすると、
  // useBlockerがまだ古いisDirty=trueを見て確認ダイアログを誤表示してしまうため)
  useEffect(() => {
    if (saveMutation.isSuccess) navigate("/bom");
  }, [saveMutation.isSuccess, navigate]);

  function tryAddLine(
    componentType: BomComponentType,
    componentId: number | null,
    quantity: number,
    conditions: BomCondition[]
  ): boolean {
    const key = lineKey({
      component_type: componentType,
      part_id: componentType === "part" ? componentId : null,
      assembly_id: componentType === "assembly" ? componentId : null,
      quantity,
      conditions,
    });
    if (lines.some((l) => lineKey(l) === key)) return false;
    setLines([
      ...lines,
      {
        component_type: componentType,
        part_id: componentType === "part" ? componentId : null,
        assembly_id: componentType === "assembly" ? componentId : null,
        quantity,
        conditions,
      },
    ]);
    return true;
  }

  // 種別が「部品不要」の場合、部品/中間品の選択は不要(常に有効)
  function draftReady(draft: { componentType: BomComponentType; componentId: number | "" }): boolean {
    return draft.componentType === "none" || draft.componentId !== "";
  }

  function handleAddCommonLine(e: FormEvent) {
    e.preventDefault();
    if (!draftReady({ componentType: newComponentType, componentId: newComponentId })) return;
    const componentId = newComponentType === "none" ? null : Number(newComponentId);
    if (tryAddLine(newComponentType, componentId, newQuantity, [])) {
      setNewComponentId("");
      setNewQuantity(1);
    }
  }

  function handleAddOptionLine(group: ItemOption, groupIndex: number, e: FormEvent) {
    e.preventDefault();
    const draft = optionDrafts[group.option_id] ?? emptyOptionDraft;
    if (!draftReady(draft) || draft.choiceId === "") return;
    const choiceIndex = group.choices.findIndex((c) => c.option_variation_id === draft.choiceId);
    const choice = choiceIndex === -1 ? undefined : group.choices[choiceIndex];
    if (!choice) return;
    const componentId = draft.componentType === "none" ? null : Number(draft.componentId);
    const added = tryAddLine(draft.componentType, componentId, draft.quantity, [
      {
        selector_type: "option",
        selector_id: choice.option_variation_id,
        group_name: group.option_name,
        choice_name: choice.variation_name,
        group_order: groupIndex,
        choice_order: choiceIndex,
      },
    ]);
    if (added) setOptionDrafts({ ...optionDrafts, [group.option_id]: emptyOptionDraft });
  }

  function handleAddVariationLine(variations: ItemVariation[], e: FormEvent) {
    e.preventDefault();
    if (!draftReady(variationDraft) || variationDraft.choiceId === "") return;
    const variationIndex = variations.findIndex((v) => v.variation_id === variationDraft.choiceId);
    const variation = variationIndex === -1 ? undefined : variations[variationIndex];
    if (!variation) return;
    const componentId = variationDraft.componentType === "none" ? null : Number(variationDraft.componentId);
    const added = tryAddLine(variationDraft.componentType, componentId, variationDraft.quantity, [
      {
        selector_type: "variation",
        selector_id: variation.variation_id,
        group_name: "種類",
        choice_name: variation.variation_name,
        group_order: null,
        choice_order: variationIndex,
      },
    ]);
    if (added) setVariationDraft(emptyOptionDraft);
  }

  function updateQuantity(key: string, quantity: number) {
    setLines(lines.map((l) => (lineKey(l) === key ? { ...l, quantity } : l)));
  }

  function removeLine(key: string) {
    setLines(lines.filter((l) => lineKey(l) !== key));
  }

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedLines = lines.filter((l) => selectedKeys.has(lineKey(l)));
  const selectedSignatures = new Set(selectedLines.map((l) => conditionsSignature(l.conditions)));
  const canExtract = selectedLines.length > 0 && selectedSignatures.size === 1;

  const extractMutation = useMutation({
    mutationFn: (input: { name: string; sku: string }) =>
      createAssembly({
        name: input.name,
        sku: input.sku || null,
        stock: 0,
        recipe: selectedLines.map((l) => ({
          material_type: l.component_type as MaterialType,
          material_id: (l.component_type === "part" ? l.part_id : l.assembly_id)!,
          quantity: l.quantity,
        })),
      }),
    onSuccess: (newAssembly) => {
      queryClient.invalidateQueries({ queryKey: ["assemblies"] });
      const sharedConditions = selectedLines[0]?.conditions ?? [];
      const remaining = lines.filter((l) => !selectedKeys.has(lineKey(l)));
      setLines([
        ...remaining,
        { component_type: "assembly", part_id: null, assembly_id: newAssembly.id, quantity: 1, conditions: sharedConditions },
      ]);
      setActiveScope(null);
      setSelectedKeys(new Set());
      setExtractDialogOpen(false);
      setExtractName("");
      setExtractSku("");
    },
  });

  const allParts = partsQuery.data ?? [];
  const allAssemblies = assembliesQuery.data ?? [];
  const partsById = new Map(allParts.map((p) => [p.id, p]));
  const assembliesById = new Map(allAssemblies.map((a) => [a.id, a]));
  const assemblyCostById = new Map((assemblyCostsQuery.data ?? []).map((c) => [c.id, c.cost]));
  const optionGroups = itemOptionsQuery.data ?? [];
  const itemVariations = itemVariationsQuery.data ?? [];
  const knownOptionChoiceIds = new Set(optionGroups.flatMap((g) => g.choices.map((c) => c.option_variation_id)));
  const knownVariationIds = new Set(itemVariations.map((v) => v.variation_id));

  const commonLines = lines.filter((l) => l.conditions.length === 0);
  const availableCommonMaterials: ComponentOption[] =
    newComponentType === "part"
      ? allParts.filter((p) => !commonLines.some((l) => l.component_type === "part" && l.part_id === p.id))
      : newComponentType === "assembly"
        ? allAssemblies
            .filter((a) => !commonLines.some((l) => l.component_type === "assembly" && l.assembly_id === a.id))
            .map((a) => ({ ...a, type: "assembly" as const }))
        : [];

  const variationLines = lines
    .filter((l) => l.conditions.length === 1 && l.conditions[0].selector_type === "variation")
    .sort(byChoiceOrder);

  const comboLines = lines.filter((l) => l.conditions.length >= 2).sort(byChoiceOrder);

  // 連携先でオプション/種類の構成が変わり、現在の選択肢一覧に存在しなくなったBOM行(単独条件のみ判定)
  const orphanLines = lines.filter((l) => {
    if (l.conditions.length !== 1) return false;
    const c = l.conditions[0];
    if (c.selector_type === "option") return !knownOptionChoiceIds.has(c.selector_id);
    return !knownVariationIds.has(c.selector_id);
  });

  // 「組み合わせ」セクションで選べる軸(オプショングループ + 種類)。2軸以上ないと組み合わせは作れない
  const axes: Axis[] = buildAxes(optionGroups, itemVariations);
  // コピー元(duplicateItemId)のBOM行が実際に参照している軸。名前が一致しない場合の
  // 手動対応付けで使う(商品側の現在のオプション/種類設定ではなく、コピーしたいBOM行
  // そのものの条件から組み立てる)
  const duplicateSourceLines = duplicateBomQuery.data ?? [];
  const sourceAxes: Axis[] = buildAxesFromConditions(duplicateSourceLines);

  // 手動対応付けの軸レベルの値(明示的な選択が無ければ、候補が1つだけの場合はそれを既定値にする)
  function axisMappingValue(targetAxis: Axis): string {
    const explicit = axisMapping[targetAxis.key];
    if (explicit !== undefined) return explicit;
    const candidates = sourceAxes.filter((sa) => sa.selectorType === targetAxis.selectorType);
    return candidates.length === 1 ? candidates[0].key : "";
  }

  // このコピー先の軸に対応するコピー元の軸を決める。グループ名が完全一致する軸があれば
  // それを使い(この場合、軸自体の対応付けUIは出さない)、無ければ手動対応付け(またはその既定値)を使う。
  // どちらも無ければnull(対応付けできない)
  function resolvedSourceAxisFor(targetAxis: Axis): { axis: Axis; isNameMatch: boolean } | null {
    const nameMatch = sourceAxes.find(
      (sa) => sa.selectorType === targetAxis.selectorType && sa.label === targetAxis.label
    );
    if (nameMatch) return { axis: nameMatch, isNameMatch: true };
    const mappedKey = axisMappingValue(targetAxis);
    const mapped = sourceAxes.find((sa) => sa.key === mappedKey);
    return mapped ? { axis: mapped, isNameMatch: false } : null;
  }

  // 手動対応付けの選択肢レベルの値(明示的な選択が無ければ、選択肢名が一致するものを既定値にする)
  function choiceMappingValue(targetAxis: Axis, sourceAxis: Axis, targetChoiceId: string): string {
    const key = `${targetAxis.key}:${targetChoiceId}`;
    const explicit = choiceMapping[key];
    if (explicit !== undefined) return explicit;
    const targetChoice = targetAxis.choices.find((c) => c.id === targetChoiceId);
    const nameMatch = sourceAxis.choices.find((c) => c.name === targetChoice?.name);
    return nameMatch?.id ?? "";
  }

  // コピー元の1条件を、コピー先の条件に解決する。軸は名前一致または手動対応付けで特定し、
  // 選択肢は名前一致または手動対応付け(choiceMappingValue)で特定する
  function resolveSourceCondition(c: BomCondition): BomCondition | null {
    const sourceAxis = sourceAxes.find((sa) => sa.selectorType === c.selector_type && sa.label === (c.group_name ?? ""));
    const sourceChoice = sourceAxis?.choices.find((ch) => ch.name === c.choice_name);
    if (!sourceAxis || !sourceChoice) return null;

    const targetAxis = axes.find((a) => resolvedSourceAxisFor(a)?.axis.key === sourceAxis.key);
    if (!targetAxis) return null;

    for (const targetChoice of targetAxis.choices) {
      if (choiceMappingValue(targetAxis, sourceAxis, targetChoice.id) === sourceChoice.id) {
        return {
          selector_type: targetAxis.selectorType,
          selector_id: targetChoice.id,
          group_name: targetAxis.label,
          choice_name: targetChoice.name,
          group_order: targetAxis.groupOrder,
          choice_order: targetChoice.order,
        };
      }
    }
    return null;
  }

  // コピー元に対応しうる軸だけを抽出する。単一条件(単一選択肢)のコピー対象は全てこの
  // セクションに集約して表示する(共通行以外をここでも一覧できるようにし、上部の
  // 「コピーされる部品/中間品」を共通行だけのシンプルな一覧にするため)
  interface AxisMappingRow {
    targetAxis: Axis;
    candidates: Axis[];
    resolved: { axis: Axis; isNameMatch: boolean } | null;
  }
  const axisMappingRows: AxisMappingRow[] = axes
    .map((targetAxis) => {
      const candidates = sourceAxes.filter((sa) => sa.selectorType === targetAxis.selectorType);
      const resolved = resolvedSourceAxisFor(targetAxis);
      return { targetAxis, candidates, resolved };
    })
    .filter((row) => row.candidates.length > 0);

  // 単一条件(単一軸+単一選択肢)のコピー元の行のうち、指定したコピー元の軸・選択肢に
  // 一致するものを全て返す。「対応先の選択肢→コピー元を1つ探す」向きではなく
  // 「コピー元の選択肢→対応先の選択肢ごとに」解決するため、複数の対応先選択肢が同じ
  // コピー元を選んだ場合、両方に独立してコピーできる(例: 新商品のS/M/Lが旧商品の
  // 「標準」1種類と同じ構成、といったケース)
  function sourceLinesForChoice(sourceAxis: Axis, sourceChoiceId: string) {
    return duplicateSourceLines.filter((l) => {
      if (l.conditions.length !== 1) return false;
      const c = l.conditions[0];
      return c.selector_type === sourceAxis.selectorType && (c.group_name ?? "") === sourceAxis.label && c.selector_id === sourceChoiceId;
    });
  }

  // 対応先の選択肢1つに対して、実際にコピーされる行を組み立てる(プレビュー表示・コピー実行の両方で使う)
  function linesForChoice(targetAxis: Axis, resolvedAxis: Axis, targetChoice: Axis["choices"][number]): Line[] {
    const sourceChoiceId = choiceMappingValue(targetAxis, resolvedAxis, targetChoice.id);
    if (!sourceChoiceId) return [];
    return sourceLinesForChoice(resolvedAxis, sourceChoiceId).map((l) => ({
      component_type: l.component_type,
      part_id: l.part_id,
      assembly_id: l.assembly_id,
      quantity: l.quantity,
      conditions: [
        {
          selector_type: targetAxis.selectorType,
          selector_id: targetChoice.id,
          group_name: targetAxis.label,
          choice_name: targetChoice.name,
          group_order: targetAxis.groupOrder,
          choice_order: targetChoice.order,
        },
      ],
    }));
  }

  // コピー元(duplicateItemId)の各行の条件を、今選んでいる商品の条件に対応付ける
  // (1つでも解決できない条件があればnull=コピー対象外)
  function matchConditionsToCurrentItem(sourceConditions: BomCondition[]): BomCondition[] | null {
    const matched: BomCondition[] = [];
    for (const c of sourceConditions) {
      const resolved = resolveSourceCondition(c);
      if (!resolved) return null;
      matched.push(resolved);
    }
    return matched;
  }

  // 共通行を先頭にまとめる(条件付き行と混ざると構成が分かりにくいため)
  const copyCandidates = [...duplicateSourceLines]
    .sort((a, b) => a.conditions.length - b.conditions.length)
    .map((l) => ({
      source: l,
      matched: l.conditions.length === 0 ? ([] as BomCondition[]) : matchConditionsToCurrentItem(l.conditions),
    }));
  // 共通行(条件なし)はそのまま常にコピーされるので単純な一覧で見せる。単一条件の行は
  // 「オプション/種類の対応付け」セクションに集約する(linesForChoice参照)。組み合わせ
  // (2条件以上)の行だけは単一の軸には収まらないため、別枠の一覧で見せる
  const copyCommonCandidates = copyCandidates.filter((c) => c.source.conditions.length === 0);
  const copyComboCandidates = copyCandidates.filter((c) => c.source.conditions.length > 1);

  const copyCommonLines: Line[] = copyCommonCandidates.map((c) => ({
    component_type: c.source.component_type,
    part_id: c.source.part_id,
    assembly_id: c.source.assembly_id,
    quantity: c.source.quantity,
    conditions: [],
  }));
  const copyAxisChoiceLines: Line[] = axisMappingRows.flatMap(({ targetAxis, resolved }) =>
    resolved ? targetAxis.choices.flatMap((tc) => linesForChoice(targetAxis, resolved.axis, tc)) : []
  );
  const copyComboLines: Line[] = copyComboCandidates
    .filter((c) => c.matched !== null)
    .map((c) => ({
      component_type: c.source.component_type,
      part_id: c.source.part_id,
      assembly_id: c.source.assembly_id,
      quantity: c.source.quantity,
      conditions: c.matched!,
    }));
  const copyMatchedCount = copyCommonLines.length + copyAxisChoiceLines.length + copyComboLines.length;

  // 対象商品を選び終え、コピー元の情報とこの商品の選択肢が揃った時点で一度だけ提案する
  useEffect(() => {
    if (
      !duplicateItemId ||
      !selectedItem ||
      seededForItemId !== selectedItem.item_id ||
      copyOffered ||
      duplicateBomQuery.isLoading ||
      itemOptionsQuery.isLoading ||
      itemVariationsQuery.isLoading
    ) {
      return;
    }
    setCopyOffered(true);
    if (duplicateSourceLines.length > 0) {
      setCopyDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    duplicateItemId,
    selectedItem,
    seededForItemId,
    copyOffered,
    duplicateBomQuery.isLoading,
    itemOptionsQuery.isLoading,
    itemVariationsQuery.isLoading,
  ]);

  function setAxisMappingValue(targetAxisKey: string, sourceAxisKey: string) {
    setAxisMapping((prev) => ({ ...prev, [targetAxisKey]: sourceAxisKey }));
    // 対応付け先の軸を変えたら、その軸に紐づく選択肢レベルの対応付けは意味を失うのでリセットする
    setChoiceMapping((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${targetAxisKey}:`)) delete next[key];
      }
      return next;
    });
  }

  function setChoiceMappingValue(targetAxisKey: string, targetChoiceId: string, sourceChoiceId: string) {
    setChoiceMapping((prev) => ({ ...prev, [`${targetAxisKey}:${targetChoiceId}`]: sourceChoiceId }));
  }

  // 対応付けできている(共通行を含む)行は無条件で全てコピーする。コピー後の行は通常の
  // 行と同じくこの場で自由に削除できるため、コピー時点で1件ずつ選ばせる必要は無い
  function applyCopy() {
    const toAdd: Line[] = [...copyCommonLines, ...copyAxisChoiceLines, ...copyComboLines];
    if (toAdd.length > 0) {
      setLines((prev) => [...prev, ...toAdd]);
      setIsDirty(true);
    }
    setCopyDialogOpen(false);
  }

  function materialName(line: Line): string {
    if (line.component_type === "part") return partsById.get(line.part_id!)?.name ?? `#${line.part_id}`;
    if (line.component_type === "assembly") return assembliesById.get(line.assembly_id!)?.name ?? `#${line.assembly_id}`;
    return "部品不要";
  }

  function lineCost(line: Line): number | null {
    if (line.component_type === "part") {
      const cost = partsById.get(line.part_id!)?.unit_cost;
      return cost != null ? cost * line.quantity : null;
    }
    if (line.component_type === "assembly") {
      const cost = assemblyCostById.get(line.assembly_id!);
      return cost != null ? cost * line.quantity : null;
    }
    return null;
  }

  const comboAxisA = axes.find((a) => a.key === comboAxisAKey);
  const comboAxisB = axes.find((a) => a.key === comboAxisBKey);
  const otherAxes = axes.filter((a) => a.key !== comboAxisAKey && a.key !== comboAxisBKey);

  function conditionFromAxisChoice(axis: Axis, choiceId: string): BomCondition | null {
    const choice = axis.choices.find((c) => c.id === choiceId);
    if (!choice) return null;
    return {
      selector_type: axis.selectorType,
      selector_id: choice.id,
      group_name: axis.label,
      choice_name: choice.name,
      group_order: axis.groupOrder,
      choice_order: choice.order,
    };
  }

  // 軸1・軸2以外の軸で「固定する」を選んだ場合、そのマスの条件に追加で含める条件
  function comboFixedConditions(): BomCondition[] {
    const fixedConditions: BomCondition[] = [];
    for (const axis of otherAxes) {
      const choiceId = comboFixedChoices[axis.key];
      if (!choiceId) continue;
      const cond = conditionFromAxisChoice(axis, choiceId);
      if (cond) fixedConditions.push(cond);
    }
    return fixedConditions;
  }

  function handleAddComboCellLine(cellKey: string, cellConditions: BomCondition[]) {
    if (!comboCellDraft || comboCellDraft.cellKey !== cellKey) return;
    if (!draftReady(comboCellDraft)) return;
    const componentId = comboCellDraft.componentType === "none" ? null : Number(comboCellDraft.componentId);
    const added = tryAddLine(comboCellDraft.componentType, componentId, comboCellDraft.quantity, cellConditions);
    if (added) {
      setComboCellDraft({ ...comboCellDraft, componentType: "part", componentId: "", quantity: 1 });
    }
  }

  function cellConditionsFor(rowChoiceId: string, colChoiceId: string): BomCondition[] | null {
    if (!comboAxisA || !comboAxisB) return null;
    const rowCond = conditionFromAxisChoice(comboAxisA, rowChoiceId);
    const colCond = conditionFromAxisChoice(comboAxisB, colChoiceId);
    if (!rowCond || !colCond) return null;
    return [rowCond, colCond, ...comboFixedConditions()];
  }

  // 指定セルの内容を、同じ列(下方向)または同じ行(右方向)の残り全セルにコピーする。
  // コピー先の既存内容は上書きする(スプレッドシートのフィルダウン/フィルライトと同じ挙動)
  function copyComboCell(direction: "down" | "right", rowChoiceId: string, colChoiceId: string) {
    if (!comboAxisA || !comboAxisB) return;
    const sourceConditions = cellConditionsFor(rowChoiceId, colChoiceId);
    if (!sourceConditions) return;
    const sourceSignature = conditionsSignature(sourceConditions);
    const sourceLines = lines.filter((l) => conditionsSignature(l.conditions) === sourceSignature);
    if (sourceLines.length === 0) return;

    const rowIndex = comboAxisA.choices.findIndex((c) => c.id === rowChoiceId);
    const colIndex = comboAxisB.choices.findIndex((c) => c.id === colChoiceId);
    const targets =
      direction === "down"
        ? comboAxisA.choices.slice(rowIndex + 1).map((c) => ({ rowId: c.id, colId: colChoiceId }))
        : comboAxisB.choices.slice(colIndex + 1).map((c) => ({ rowId: rowChoiceId, colId: c.id }));
    if (targets.length === 0) return;

    const targetConditionsList = targets
      .map((t) => cellConditionsFor(t.rowId, t.colId))
      .filter((c): c is BomCondition[] => c !== null);
    const targetSignatures = new Set(targetConditionsList.map((c) => conditionsSignature(c)));

    const kept = lines.filter((l) => !targetSignatures.has(conditionsSignature(l.conditions)));
    const added: Line[] = targetConditionsList.flatMap((conditions) =>
      sourceLines.map((sl) => ({ ...sl, conditions }))
    );
    setLines([...kept, ...added]);
  }

  // BOM一覧のオプション/組み合わせ行から遷移してきた(?highlight_option=)場合、対象の
  // カードを一時的にハイライトしてスクロールする。対象データ(optionGroups/axes)は
  // 連携先からの非同期取得なので、揃うまで待ってから発火する
  useEffect(() => {
    if (!highlightOption) return;
    const ready = highlightOption === COMBO_HIGHLIGHT_KEY ? axes.length >= 2 : optionGroups.length > 0;
    if (!ready) return;
    setFlashOption(highlightOption);
    searchParams.delete("highlight_option");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightOption, optionGroups.length, axes.length]);

  useEffect(() => {
    if (!flashOption) return;
    document.getElementById(bomOptionCardId(flashOption))?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlashOption(null), 2500);
    return () => clearTimeout(timer);
  }, [flashOption]);

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{routeItemId ? "BOM編集" : "BOM新規作成"}</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            商品を選び、消費する部品・中間品と数量を登録します（「保存」を押すまでサーバーには反映されません）
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!selectedItem || saveMutation.isPending || lines.length === 0}
          className="self-start"
        >
          {saveMutation.isPending ? "保存中..." : "保存"}
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="grid gap-4 pt-6">
          <div className="grid gap-1.5">
            <Label>商品</Label>
            <ItemCombobox
              shopId={shopId}
              value={selectedItem}
              onChange={handleItemChange}
              locked={!!routeItemId}
              excludeItemIds={duplicateExcludeItemIds}
            />
          </div>
          {selectedItem && (
            <>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={productSettingQuery.data?.matrix_layout ?? false}
                    disabled={!productSettingQuery.data || productSettingMutation.isPending}
                    onChange={(e) =>
                      productSettingMutation.mutate(
                        {
                          matrixLayout: e.target.checked,
                          buildableAlertThreshold: savedBuildableAlertThreshold,
                        },
                        productSettingFeedback.callbacks("matrix_layout")
                      )
                    }
                  />
                  注文一覧PDF出力時、オプションを横並びの表にする
                </label>
                <SaveFlashCheck show={productSettingFeedback.isFlashing("matrix_layout")} />
              </div>
              <FieldError message={productSettingFeedback.errorFor("matrix_layout")} />
              <div className="grid gap-1.5">
                <Label htmlFor="buildable_alert_threshold">作成可能数アラートの閾値</Label>
                <p className="text-xs text-muted-foreground-subtle">
                  作成可能数がこの数値を下回ったら通知します(未設定なら通知しません)
                </p>
                <div className="flex items-center gap-2">
                  <NumberInput
                    id="buildable_alert_threshold"
                    placeholder="未設定"
                    value={buildableAlertThreshold}
                    onChange={setBuildableAlertThreshold}
                    disabled={!productSettingQuery.data || productSettingMutation.isPending}
                    onBlur={() =>
                      productSettingMutation.mutate(
                        {
                          matrixLayout: productSettingQuery.data?.matrix_layout ?? false,
                          buildableAlertThreshold:
                            buildableAlertThreshold === "" ? null : Number(buildableAlertThreshold),
                        },
                        productSettingFeedback.callbacks("buildable_alert_threshold")
                      )
                    }
                    className="w-32 text-right"
                  />
                  <SaveFlashCheck show={productSettingFeedback.isFlashing("buildable_alert_threshold")} />
                </div>
                <FieldError message={productSettingFeedback.errorFor("buildable_alert_threshold")} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {selectedItem && (
        <div className="mt-6 grid gap-8">
          <Card>
            <CardHeader>
              <CardTitle>共通</CardTitle>
              <CardDescription>オプション未選択時も含め、常に消費する部品・中間品</CardDescription>
              {commonLines.length > 0 && activeScope !== "common" && (
                <ConvertMenu onStart={() => startSelecting("common")} />
              )}
            </CardHeader>
            <CardContent className="grid gap-6">
              {commonLines.length > 0 && (
                <>
                  {activeScope === "common" && (
                    <ConvertActiveBar
                      selectedCount={selectedLines.length}
                      canExtract={canExtract}
                      onCancel={cancelSelecting}
                      onOpenDialog={() => setExtractDialogOpen(true)}
                    />
                  )}
                  <LineTable
                    lines={commonLines}
                    partsById={partsById}
                    assembliesById={assembliesById}
                    assemblyCostById={assemblyCostById}
                    showTotalCost
                    onUpdateQuantity={updateQuantity}
                    onRemove={removeLine}
                    selectable={activeScope === "common"}
                    selectedKeys={selectedKeys}
                    onToggleSelect={toggleSelect}
                  />
                </>
              )}

              <form onSubmit={handleAddCommonLine} className="flex flex-wrap items-end gap-6 rounded-lg border bg-muted/40 dark:bg-muted/80 p-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="common-type" className="text-xs">種別</Label>
                  <select
                    id="common-type"
                    className="h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    value={newComponentType}
                    onChange={(e) => {
                      setNewComponentType(e.target.value as BomComponentType);
                      setNewComponentId("");
                    }}
                  >
                    <option value="part">部品</option>
                    <option value="assembly">中間品</option>
                    <option value="none">部品不要</option>
                  </select>
                </div>
                {newComponentType !== "none" && (
                  <>
                    <div className="grid flex-1 gap-1.5">
                      <Label htmlFor="common-material" className="text-xs">追加する部品/中間品</Label>
                      <ComponentCombobox
                        id="common-material"
                        items={availableCommonMaterials}
                        value={newComponentId}
                        onChange={setNewComponentId}
                      />
                    </div>
                    <div className="grid w-24 gap-1.5">
                      <Label htmlFor="common-quantity" className="text-xs">数量</Label>
                      <NumberInput
                        id="common-quantity"
                        value={String(newQuantity)}
                        onChange={(v) => setNewQuantity(Number(v))}
                        className="text-right text-xs"
                      />
                    </div>
                  </>
                )}
                <Button
                  type="submit"
                  variant="outline"
                  className="text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
                  disabled={!draftReady({ componentType: newComponentType, componentId: newComponentId })}
                >
                  行を追加
                </Button>
              </form>
            </CardContent>
          </Card>

          {itemOptionsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">オプション情報を取得中...</p>
          )}
          {itemOptionsQuery.error && (
            <p className="text-sm text-destructive">
              オプション情報の取得に失敗しました: {(itemOptionsQuery.error as Error).message}
            </p>
          )}

          {optionGroups.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">オプション</h2>
              <div className="grid gap-8 lg:grid-cols-2">
                {optionGroups.map((group, groupIndex) => {
                  const isOptionChoiceLine = (l: Line, choiceId: string) =>
                    l.conditions.length === 1 &&
                    l.conditions[0].selector_type === "option" &&
                    l.conditions[0].selector_id === choiceId;
                  const groupLines = lines
                    .filter(
                      (l) =>
                        l.conditions.length === 1 &&
                        l.conditions[0].selector_type === "option" &&
                        group.choices.some((c) => c.option_variation_id === l.conditions[0].selector_id)
                    )
                    .sort(byChoiceOrder);
                  const draft = optionDrafts[group.option_id] ?? emptyOptionDraft;
                  const availableMaterials: ComponentOption[] =
                    draft.componentType === "part"
                      ? allParts.filter(
                          (p) =>
                            !lines.some(
                              (l) =>
                                l.component_type === "part" &&
                                l.part_id === p.id &&
                                isOptionChoiceLine(l, draft.choiceId)
                            )
                        )
                      : draft.componentType === "assembly"
                        ? allAssemblies
                            .filter(
                              (a) =>
                                !lines.some(
                                  (l) =>
                                    l.component_type === "assembly" &&
                                    l.assembly_id === a.id &&
                                    isOptionChoiceLine(l, draft.choiceId)
                                )
                            )
                            .map((a) => ({ ...a, type: "assembly" as const }))
                        : [];

                  return (
                    <Card
                      key={group.option_id}
                      id={bomOptionCardId(group.option_name)}
                      className={cn(flashOption === group.option_name && "bg-amber-100 dark:bg-amber-500/20")}
                    >
                      <CardHeader>
                        <CardTitle>{group.option_name}</CardTitle>
                        <CardDescription>選択肢ごとに追加で消費する部品・中間品</CardDescription>
                        {groupLines.length > 0 && activeScope !== `option:${group.option_id}` && (
                          <ConvertMenu onStart={() => startSelecting(`option:${group.option_id}`)} />
                        )}
                      </CardHeader>
                      <CardContent className="grid gap-6">
                        {groupLines.length > 0 && (
                          <>
                            {activeScope === `option:${group.option_id}` && (
                              <ConvertActiveBar
                                selectedCount={selectedLines.length}
                                canExtract={canExtract}
                                onCancel={cancelSelecting}
                                onOpenDialog={() => setExtractDialogOpen(true)}
                              />
                            )}
                            <LineTable
                              lines={groupLines}
                              partsById={partsById}
                              assembliesById={assembliesById}
                              assemblyCostById={assemblyCostById}
                              onUpdateQuantity={updateQuantity}
                              onRemove={removeLine}
                              selectable={activeScope === `option:${group.option_id}`}
                              selectedKeys={selectedKeys}
                              onToggleSelect={toggleSelect}
                              showChoice
                            />
                          </>
                        )}

                        <form
                          onSubmit={(e) => handleAddOptionLine(group, groupIndex, e)}
                          className="grid gap-6 rounded-lg border bg-muted/40 dark:bg-muted/80 p-4"
                        >
                          <div className="grid gap-1.5">
                            <Label htmlFor={`choice-${group.option_id}`}>選択肢</Label>
                            <select
                              id={`choice-${group.option_id}`}
                              className="h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                              value={draft.choiceId}
                              onChange={(e) =>
                                setOptionDrafts({
                                  ...optionDrafts,
                                  [group.option_id]: { ...draft, choiceId: e.target.value },
                                })
                              }
                            >
                              <option value="">選択してください</option>
                              {group.choices.map((c) => (
                                <option key={c.option_variation_id} value={c.option_variation_id}>
                                  {c.variation_name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-end gap-6">
                            <div className="grid gap-1.5">
                              <Label htmlFor={`type-${group.option_id}`}>種別</Label>
                              <select
                                id={`type-${group.option_id}`}
                                className="h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                                value={draft.componentType}
                                onChange={(e) =>
                                  setOptionDrafts({
                                    ...optionDrafts,
                                    [group.option_id]: {
                                      ...draft,
                                      componentType: e.target.value as BomComponentType,
                                      componentId: "",
                                    },
                                  })
                                }
                              >
                                <option value="part">部品</option>
                                <option value="assembly">中間品</option>
                                <option value="none">部品不要</option>
                              </select>
                            </div>
                            {draft.componentType !== "none" && (
                              <>
                                <div className="grid flex-1 gap-1.5">
                                  <Label htmlFor={`part-${group.option_id}`}>部品/中間品</Label>
                                  <ComponentCombobox
                                    id={`part-${group.option_id}`}
                                    items={availableMaterials}
                                    value={draft.componentId}
                                    onChange={(id) =>
                                      setOptionDrafts({
                                        ...optionDrafts,
                                        [group.option_id]: { ...draft, componentId: id },
                                      })
                                    }
                                  />
                                </div>
                                <div className="grid w-20 gap-1.5">
                                  <Label htmlFor={`quantity-${group.option_id}`}>数量</Label>
                                  <NumberInput
                                    id={`quantity-${group.option_id}`}
                                    value={String(draft.quantity)}
                                    onChange={(v) =>
                                      setOptionDrafts({
                                        ...optionDrafts,
                                        [group.option_id]: { ...draft, quantity: Number(v) },
                                      })
                                    }
                                    className="text-right text-xs"
                                  />
                                </div>
                              </>
                            )}
                            <Button
                              type="submit"
                              variant="outline"
                              className="text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
                              disabled={!draftReady(draft) || draft.choiceId === ""}
                            >
                              追加
                            </Button>
                          </div>
                        </form>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {itemVariationsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">種類情報を取得中...</p>
          )}
          {itemVariationsQuery.error && (
            <p className="text-sm text-destructive">
              種類情報の取得に失敗しました: {(itemVariationsQuery.error as Error).message}
            </p>
          )}

          {itemVariations.length > 0 &&
            (() => {
              const isVariationChoiceLine = (l: Line, choiceId: string) =>
                l.conditions.length === 1 &&
                l.conditions[0].selector_type === "variation" &&
                l.conditions[0].selector_id === choiceId;
              const availableMaterials: ComponentOption[] =
                variationDraft.componentType === "part"
                  ? allParts.filter(
                      (p) =>
                        !lines.some(
                          (l) =>
                            l.component_type === "part" &&
                            l.part_id === p.id &&
                            isVariationChoiceLine(l, variationDraft.choiceId)
                        )
                    )
                  : variationDraft.componentType === "assembly"
                    ? allAssemblies
                        .filter(
                          (a) =>
                            !lines.some(
                              (l) =>
                                l.component_type === "assembly" &&
                                l.assembly_id === a.id &&
                                isVariationChoiceLine(l, variationDraft.choiceId)
                            )
                        )
                        .map((a) => ({ ...a, type: "assembly" as const }))
                    : [];

              return (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">種類</h2>
                  <Card>
                    <CardHeader>
                      <CardTitle>種類</CardTitle>
                      <CardDescription>
                        単一属性の種類(色・サイズ等)ごとに追加で消費する部品・中間品
                      </CardDescription>
                      {variationLines.length > 0 && activeScope !== "variation" && (
                        <ConvertMenu onStart={() => startSelecting("variation")} />
                      )}
                    </CardHeader>
                    <CardContent className="grid gap-6">
                      {variationLines.length > 0 && (
                        <>
                          {activeScope === "variation" && (
                            <ConvertActiveBar
                              selectedCount={selectedLines.length}
                              canExtract={canExtract}
                              onCancel={cancelSelecting}
                              onOpenDialog={() => setExtractDialogOpen(true)}
                            />
                          )}
                          <LineTable
                            lines={variationLines}
                            partsById={partsById}
                            assembliesById={assembliesById}
                            assemblyCostById={assemblyCostById}
                            onUpdateQuantity={updateQuantity}
                            onRemove={removeLine}
                            selectable={activeScope === "variation"}
                            selectedKeys={selectedKeys}
                            onToggleSelect={toggleSelect}
                            showChoice
                          />
                        </>
                      )}

                      <form
                        onSubmit={(e) => handleAddVariationLine(itemVariations, e)}
                        className="grid gap-6 rounded-lg border bg-muted/40 dark:bg-muted/80 p-4"
                      >
                        <div className="grid gap-1.5">
                          <Label htmlFor="variation-choice" className="text-xs">選択肢</Label>
                          <select
                            id="variation-choice"
                            className="h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                            value={variationDraft.choiceId}
                            onChange={(e) =>
                              setVariationDraft({ ...variationDraft, choiceId: e.target.value })
                            }
                          >
                            <option value="">選択してください</option>
                            {itemVariations.map((v) => (
                              <option key={v.variation_id} value={v.variation_id}>
                                {v.variation_name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end gap-6">
                          <div className="grid gap-1.5">
                            <Label htmlFor="variation-type" className="text-xs">種別</Label>
                            <select
                              id="variation-type"
                              className="h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                              value={variationDraft.componentType}
                              onChange={(e) =>
                                setVariationDraft({
                                  ...variationDraft,
                                  componentType: e.target.value as BomComponentType,
                                  componentId: "",
                                })
                              }
                            >
                              <option value="part">部品</option>
                              <option value="assembly">中間品</option>
                              <option value="none">部品不要</option>
                            </select>
                          </div>
                          {variationDraft.componentType !== "none" && (
                            <>
                              <div className="grid flex-1 gap-1.5">
                                <Label htmlFor="variation-material" className="text-xs">部品/中間品</Label>
                                <ComponentCombobox
                                  id="variation-material"
                                  items={availableMaterials}
                                  value={variationDraft.componentId}
                                  onChange={(id) => setVariationDraft({ ...variationDraft, componentId: id })}
                                />
                              </div>
                              <div className="grid w-20 gap-1.5">
                                <Label htmlFor="variation-quantity" className="text-xs">数量</Label>
                                <NumberInput
                                  id="variation-quantity"
                                  value={String(variationDraft.quantity)}
                                  onChange={(v) =>
                                    setVariationDraft({ ...variationDraft, quantity: Number(v) })
                                  }
                                  className="text-right text-xs"
                                />
                              </div>
                            </>
                          )}
                          <Button
                            type="submit"
                            variant="outline"
                            className="text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
                            disabled={!draftReady(variationDraft) || variationDraft.choiceId === ""}
                          >
                            追加
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

          {axes.length >= 2 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">組み合わせ</h2>
              <Card
                id={bomOptionCardId(COMBO_HIGHLIGHT_KEY)}
                className={cn(flashOption === COMBO_HIGHLIGHT_KEY && "bg-amber-100 dark:bg-amber-500/20")}
              >
                <CardHeader>
                  <CardTitle>組み合わせ</CardTitle>
                  <CardDescription>
                    複数の軸(オプション/種類)の組み合わせによって消費する部品が変わる場合に使います。
                    2つの軸を選ぶと表が出るので、必要なマスだけ部品/中間品と数量を入力してください
                  </CardDescription>
                  {comboLines.length > 0 && activeScope !== "combo" && (
                    <ConvertMenu onStart={() => startSelecting("combo")} />
                  )}
                </CardHeader>
                <CardContent className="grid gap-6">
                  {comboLines.length > 0 && activeScope === "combo" && (
                    <ConvertActiveBar
                      selectedCount={selectedLines.length}
                      canExtract={canExtract}
                      onCancel={cancelSelecting}
                      onOpenDialog={() => setExtractDialogOpen(true)}
                    />
                  )}

                  <div className="grid gap-6 rounded-lg border bg-muted/40 dark:bg-muted/80 p-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="combo-axis-a" className="text-xs">軸1(縦)</Label>
                        <select
                          id="combo-axis-a"
                          className="h-8 w-48 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                          value={comboAxisAKey}
                          onChange={(e) => {
                            setComboAxisAKey(e.target.value);
                            setComboFixedChoices({});
                            setComboCellDraft(null);
                          }}
                        >
                          <option value="">選択してください</option>
                          {axes.map((a) => (
                            <option key={a.key} value={a.key} disabled={a.key === comboAxisBKey}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="combo-axis-b" className="text-xs">軸2(横)</Label>
                        <select
                          id="combo-axis-b"
                          className="h-8 w-48 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                          value={comboAxisBKey}
                          onChange={(e) => {
                            setComboAxisBKey(e.target.value);
                            setComboFixedChoices({});
                            setComboCellDraft(null);
                          }}
                        >
                          <option value="">選択してください</option>
                          {axes.map((a) => (
                            <option key={a.key} value={a.key} disabled={a.key === comboAxisAKey}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {comboAxisA && comboAxisB && otherAxes.length > 0 && (
                      <div className="flex flex-wrap items-end gap-3">
                        {otherAxes.map((axis) => (
                          <div key={axis.key} className="grid gap-1.5">
                            <Label htmlFor={`combo-fixed-${axis.key}`}>{axis.label}を固定(任意)</Label>
                            <select
                              id={`combo-fixed-${axis.key}`}
                              className="h-8 w-44 rounded-lg border border-input bg-card px-2.5 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                              value={comboFixedChoices[axis.key] ?? ""}
                              onChange={(e) =>
                                setComboFixedChoices({ ...comboFixedChoices, [axis.key]: e.target.value })
                              }
                            >
                              <option value="">指定しない</option>
                              {axis.choices.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {comboAxisA && comboAxisB && (
                      <div className="overflow-x-auto">
                        <table className="border-collapse text-xs">
                          <thead>
                            <tr>
                              <th className="border border-border p-1.5"></th>
                              {comboAxisB.choices.map((colChoice) => (
                                <th
                                  key={colChoice.id}
                                  className="border border-border p-1.5 font-medium whitespace-nowrap"
                                >
                                  {colChoice.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {comboAxisA.choices.map((rowChoice, rowIndex) => (
                              <tr key={rowChoice.id}>
                                <th className="border border-border p-1.5 text-left font-medium whitespace-nowrap">
                                  {rowChoice.name}
                                </th>
                                {comboAxisB!.choices.map((colChoice, colIndex) => {
                                  const cellKey = `${rowChoice.id}|${colChoice.id}`;
                                  const rowCond = conditionFromAxisChoice(comboAxisA, rowChoice.id);
                                  const colCond = conditionFromAxisChoice(comboAxisB, colChoice.id);
                                  if (!rowCond || !colCond) return <td key={colChoice.id} />;
                                  const cellConditions = [rowCond, colCond, ...comboFixedConditions()];
                                  const cellSignature = conditionsSignature(cellConditions);
                                  const cellLines = lines.filter(
                                    (l) => conditionsSignature(l.conditions) === cellSignature
                                  );
                                  const draft = comboCellDraft?.cellKey === cellKey ? comboCellDraft : null;
                                  const availableCellMaterials: ComponentOption[] =
                                    draft?.componentType === "part"
                                      ? allParts.filter(
                                          (p) => !cellLines.some((l) => l.component_type === "part" && l.part_id === p.id)
                                        )
                                      : draft?.componentType === "assembly"
                                        ? allAssemblies
                                            .filter(
                                              (a) =>
                                                !cellLines.some(
                                                  (l) => l.component_type === "assembly" && l.assembly_id === a.id
                                                )
                                            )
                                            .map((a) => ({ ...a, type: "assembly" as const }))
                                        : [];
                                  return (
                                    <td key={colChoice.id} className="border border-border p-1.5 align-top">
                                      <div className="grid min-w-36 gap-1">
                                        {cellLines.map((l) => {
                                          const key = lineKey(l);
                                          return (
                                            <div
                                              key={key}
                                              className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-1 text-[11px]"
                                            >
                                              {activeScope === "combo" && (
                                                <input
                                                  type="checkbox"
                                                  className="size-3 shrink-0 accent-primary"
                                                  checked={selectedKeys.has(key)}
                                                  onChange={() => toggleSelect(key)}
                                                />
                                              )}
                                              <span className="flex flex-1 items-center gap-1 whitespace-nowrap">
                                                {l.component_type === "none" ? (
                                                  <NoPartsNeededMark />
                                                ) : l.component_type === "assembly" ? (
                                                  <AssemblyMark group={assembliesById.get(l.assembly_id!)?.group}>
                                                    {materialName(l)}
                                                  </AssemblyMark>
                                                ) : (
                                                  <ComponentLabel
                                                    name={materialName(l)}
                                                    group={partsById.get(l.part_id!)?.group}
                                                    colors={partsById.get(l.part_id!)?.colors}
                                                    tags={partsById.get(l.part_id!)?.tags}
                                                  />
                                                )}
                                                <span className="shrink-0">× {l.quantity}</span>
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => removeLine(key)}
                                                className="shrink-0 text-muted-foreground-subtle hover:text-destructive"
                                                aria-label="削除"
                                              >
                                                ×
                                              </button>
                                            </div>
                                          );
                                        })}
                                        {cellLines.length > 0 && (
                                          <div className="text-right text-[10px] text-muted-foreground-subtle">
                                            見積原価 ¥
                                            {formatNumber(cellLines.reduce((sum, l) => sum + (lineCost(l) ?? 0), 0))}
                                          </div>
                                        )}
                                        {cellLines.length > 0 && (
                                          <div className="flex gap-1">
                                            {rowIndex < comboAxisA.choices.length - 1 && (
                                              <Hint label="下のセルへコピー(上書き)">
                                                <button
                                                  type="button"
                                                  onClick={() => copyComboCell("down", rowChoice.id, colChoice.id)}
                                                  className="flex h-5 flex-1 items-center justify-center rounded border border-border text-muted-foreground-subtle hover:bg-muted hover:text-foreground"
                                                  aria-label="下のセルへコピー"
                                                >
                                                  <ArrowDown className="size-3" />
                                                </button>
                                              </Hint>
                                            )}
                                            {colIndex < comboAxisB!.choices.length - 1 && (
                                              <Hint label="右のセルへコピー(上書き)">
                                                <button
                                                  type="button"
                                                  onClick={() => copyComboCell("right", rowChoice.id, colChoice.id)}
                                                  className="flex h-5 flex-1 items-center justify-center rounded border border-border text-muted-foreground-subtle hover:bg-muted hover:text-foreground"
                                                  aria-label="右のセルへコピー"
                                                >
                                                  <ArrowRight className="size-3" />
                                                </button>
                                              </Hint>
                                            )}
                                          </div>
                                        )}
                                        {draft ? (
                                          <div className="grid gap-1 rounded-md border border-border p-1.5">
                                            <select
                                              className="h-6 rounded border border-input bg-card px-1 text-[11px] outline-none dark:bg-input/30"
                                              value={draft.componentType}
                                              onChange={(e) =>
                                                setComboCellDraft({
                                                  ...draft,
                                                  componentType: e.target.value as BomComponentType,
                                                  componentId: "",
                                                })
                                              }
                                            >
                                              <option value="part">部品</option>
                                              <option value="assembly">中間品</option>
                                              <option value="none">部品不要</option>
                                            </select>
                                            {draft.componentType !== "none" && (
                                              <>
                                                <ComponentCombobox
                                                  items={availableCellMaterials}
                                                  value={draft.componentId}
                                                  onChange={(id) => setComboCellDraft({ ...draft, componentId: id })}
                                                />
                                                <NumberInput
                                                  className="h-6 w-full rounded-md px-1.5 py-0.5 text-right text-[11px]"
                                                  value={String(draft.quantity)}
                                                  onChange={(v) => setComboCellDraft({ ...draft, quantity: Number(v) })}
                                                />
                                              </>
                                            )}
                                            <div className="flex gap-1">
                                              <Button
                                                type="button"
                                                size="sm"
                                                className="h-6 flex-1 px-1.5 text-[11px]"
                                                disabled={!draftReady(draft)}
                                                onClick={() => handleAddComboCellLine(cellKey, cellConditions)}
                                              >
                                                追加
                                              </Button>
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 px-1.5 text-[11px]"
                                                onClick={() => setComboCellDraft(null)}
                                              >
                                                閉じる
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-1.5 text-[11px] text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
                                            onClick={() =>
                                              setComboCellDraft({ cellKey, componentType: "part", componentId: "", quantity: 1 })
                                            }
                                          >
                                            ＋ 追加
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {orphanLines.length > 0 && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-muted-foreground">不明なオプション</CardTitle>
                <CardDescription>
                  オプション構成が変わり、現在の選択肢に見つからない行です。不要なら削除してください。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LineTable
                  lines={orphanLines}
                  partsById={partsById}
                  assembliesById={assembliesById}
                  assemblyCostById={assemblyCostById}
                  onUpdateQuantity={updateQuantity}
                  onRemove={removeLine}
                  selectedKeys={selectedKeys}
                  onToggleSelect={toggleSelect}
                  showChoice
                />
              </CardContent>
            </Card>
          )}

          {saveMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(saveMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      <Dialog open={extractDialogOpen} onOpenChange={(open) => !open && setExtractDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>選択した{selectedLines.length}件を中間品に変換</DialogTitle>
            <DialogDescription>
              選択した行をまとめて新しい中間品として登録し、このBOMの行は登録した中間品を参照する1行(数量1)に置き換えます(「保存」を押すまでサーバーには反映されません)。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="extract-name">
                中間品名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="extract-name"
                value={extractName}
                onChange={(e) => setExtractName(e.target.value)}
                onBlur={() => setExtractNameTouched(true)}
                aria-invalid={extractNameTouched && !extractName.trim()}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="extract-sku">SKU</Label>
              <Input id="extract-sku" value={extractSku} onChange={(e) => setExtractSku(e.target.value)} />
            </div>
          </div>
          {extractMutation.error && (
            <p className="text-sm text-destructive">{(extractMutation.error as Error).message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtractDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              disabled={!extractName.trim() || extractMutation.isPending}
              onClick={() => extractMutation.mutate({ name: extractName.trim(), sku: extractSku.trim() })}
            >
              {extractMutation.isPending ? "作成中..." : "作成して置き換える"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyDialogOpen} onOpenChange={(open) => !open && setCopyDialogOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              「{duplicateItemQuery.data?.title ?? duplicateItemId}」の構成をコピーしますか？
            </DialogTitle>
            <DialogDescription>
              コピー後もこの場で自由に削除・修正できます(「保存」を押すまでサーバーには反映されません)。
            </DialogDescription>
          </DialogHeader>

          {copyCommonCandidates.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">コピーされる部品/中間品(共通)</p>
              <div className="grid gap-1 rounded-lg border border-border p-2">
                {copyCommonCandidates.map((c) => (
                  <div key={lineKey(c.source)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {materialName(c.source)} × {formatNumber(c.source.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {axisMappingRows.length > 0 && (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">オプション/種類ごとにコピーされる部品/中間品</p>
              {axisMappingRows.map(({ targetAxis, candidates, resolved }) => (
                <div key={targetAxis.key} className="grid gap-1.5">
                  {candidates.length > 1 ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{targetAxis.label}</span>
                      <span className="text-xs text-muted-foreground">に対応するコピー元は</span>
                      <select
                        className="h-8 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                        value={axisMappingValue(targetAxis)}
                        onChange={(e) => setAxisMappingValue(targetAxis.key, e.target.value)}
                      >
                        <option value="">対応付けない</option>
                        {candidates.map((sa) => (
                          <option key={sa.key} value={sa.key}>
                            {sa.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    // コピー元候補が1つしかない場合、選びようがないセレクトを出すと
                    // (特に手動ショップの種類軸のように双方が同じラベルの場合)
                    // 「種類に対応するコピー元は種類」のような無意味な表示になるため、
                    // ラベルだけを出す
                    <p className="text-sm font-medium">{targetAxis.label}</p>
                  )}
                  {resolved && (
                    <div className="grid gap-1 pl-4">
                      {targetAxis.choices.map((targetChoice) => {
                        const resolvedChoiceId = choiceMappingValue(targetAxis, resolved.axis, targetChoice.id);
                        const materials = resolvedChoiceId ? linesForChoice(targetAxis, resolved.axis, targetChoice) : [];
                        return (
                          <div key={targetChoice.id} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0 truncate font-medium">{targetChoice.name}</span>
                            <span className="text-muted-foreground">←</span>
                            <select
                              className="h-7 shrink-0 rounded-md border border-input bg-card px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                              value={resolvedChoiceId}
                              onChange={(e) => setChoiceMappingValue(targetAxis.key, targetChoice.id, e.target.value)}
                            >
                              <option value="">コピーしない</option>
                              {resolved.axis.choices.map((sc) => (
                                <option key={sc.id} value={sc.id}>
                                  {sc.name}
                                </option>
                              ))}
                            </select>
                            {resolvedChoiceId && (
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {materials.length > 0
                                  ? materials.map((m) => `${materialName(m)} × ${formatNumber(m.quantity)}`).join(", ")
                                  : "コピーする部品/中間品なし"}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {copyComboCandidates.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">組み合わせ</p>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {copyComboCandidates.map((c) => (
                  <div
                    key={lineKey(c.source)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                      c.matched === null && "text-muted-foreground"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {materialName(c.source)} × {formatNumber(c.source.quantity)}
                      <span className="ml-1.5 text-xs text-muted-foreground">{conditionsLabel(c.source.conditions)}</span>
                    </span>
                    {c.matched === null && <span className="shrink-0 text-xs">対応付けが必要です</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              コピーしない
            </Button>
            <Button disabled={copyMatchedCount === 0} onClick={applyCopy}>
              {copyMatchedCount}件をコピー
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

// 「行を選んで中間品にまとめる」の起動メニュー。普段は隠しておき、カード右上の
// ⋮メニューからだけ辿れるようにする(補助的な機能を常設表示しない方がよいという
// フィードバックを受けての設計。既存のその他操作メニューと同じ見た目に揃える)
function ConvertMenu({ onStart }: { onStart: () => void }) {
  return (
    <CardAction>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="その他の操作">
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onStart}>行を選んで中間品にする</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </CardAction>
  );
}

// 選択中バー。テーブルの直上に置き、選択操作とその次のアクション(変換する/
// キャンセル)を同じ場所に留める(離れた場所にあると分かりにくいというフィードバックを
// 受けての設計)。ConvertMenuで選択モードに入っている間だけ表示する
function ConvertActiveBar({
  selectedCount,
  canExtract,
  onCancel,
  onOpenDialog,
}: {
  selectedCount: number;
  canExtract: boolean;
  onCancel: () => void;
  onOpenDialog: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 dark:bg-muted/80 px-3 py-2 text-xs">
      <span>左のチェックボックスで行を選択({selectedCount}件選択中)</span>
      {selectedCount > 0 &&
        (canExtract ? (
          <Button type="button" size="sm" onClick={onOpenDialog}>
            中間品にする
          </Button>
        ) : (
          <span className="text-destructive">同じ条件の行だけを選べます</span>
        ))}
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        キャンセル
      </Button>
    </div>
  );
}

function LineTable({
  lines,
  partsById,
  assembliesById,
  assemblyCostById,
  onUpdateQuantity,
  onRemove,
  showChoice,
  showTotalCost,
  selectable,
  selectedKeys,
  onToggleSelect,
}: {
  lines: Line[];
  partsById: Map<number, { id: number; name: string; group?: string | null; colors?: string[] | null; tags?: string[] | null; available?: number; unit_cost?: number | null }>;
  assembliesById: Map<number, { id: number; name: string; group?: string | null; available?: number }>;
  assemblyCostById: Map<number, number>;
  onUpdateQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  showChoice?: boolean;
  // 共通行のように「表内の全行が同時に消費される」場合にのみ、原価の合計を表示する。
  // オプション/種類のように行ごとに別の選択肢を表す表では、合計すると意味のない
  // (択一のはずの複数選択肢の原価を足し合わせた)数字になるため出さない
  showTotalCost?: boolean;
  selectable?: boolean;
  selectedKeys: Set<string>;
  onToggleSelect: (key: string) => void;
}) {
  function materialAvailable(line: Line): number | undefined {
    if (line.component_type === "part") return partsById.get(line.part_id!)?.available;
    if (line.component_type === "assembly") return assembliesById.get(line.assembly_id!)?.available;
    return undefined;
  }
  function materialCost(line: Line): number | null {
    if (line.component_type === "part") {
      const cost = partsById.get(line.part_id!)?.unit_cost;
      return cost != null ? cost * line.quantity : null;
    }
    if (line.component_type === "assembly") {
      const cost = assemblyCostById.get(line.assembly_id!);
      return cost != null ? cost * line.quantity : null;
    }
    return null;
  }
  function materialName(line: Line): string | null {
    if (line.component_type === "part") {
      return partsById.get(line.part_id!)?.name ?? `#${line.part_id}`;
    }
    if (line.component_type === "assembly") {
      return assembliesById.get(line.assembly_id!)?.name ?? `#${line.assembly_id}`;
    }
    return null;
  }

  function materialPart(line: Line) {
    return line.component_type === "part" ? partsById.get(line.part_id!) : undefined;
  }

  function choiceLabel(line: Line): string {
    if (line.conditions.length === 0) return "-";
    if (line.conditions.length === 1) return line.conditions[0].choice_name ?? "-";
    return conditionsLabel(line.conditions);
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          {selectable && <TableHead className="w-8"></TableHead>}
          {showChoice && <TableHead>選択肢</TableHead>}
          <TableHead>部品/中間品</TableHead>
          <TableHead className="w-24">数量</TableHead>
          <TableHead className="w-24 text-right">原価</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => {
          const key = lineKey(line);
          return (
            <TableRow key={key}>
              {selectable && (
                <TableCell>
                  {line.component_type !== "none" && (
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={selectedKeys.has(key)}
                      onChange={() => onToggleSelect(key)}
                    />
                  )}
                </TableCell>
              )}
              {showChoice && <TableCell>{choiceLabel(line)}</TableCell>}
              <TableCell>
                {line.component_type === "none" ? (
                  <NoPartsNeededMark />
                ) : (
                  <span className="relative inline-flex">
                    {line.component_type === "assembly" ? (
                      <AssemblyMark group={line.assembly_id != null ? assembliesById.get(line.assembly_id)?.group : null}>
                        {materialName(line)}
                      </AssemblyMark>
                    ) : (
                      <ComponentLabel
                        name={materialName(line) ?? ""}
                        group={materialPart(line)?.group}
                        colors={materialPart(line)?.colors}
                        tags={materialPart(line)?.tags}
                      />
                    )}
                    {materialAvailable(line) !== undefined && (
                      <Hint label={`利用可能数: ${formatNumber(materialAvailable(line)!)}`}>
                        <span
                          className={cn(
                            "absolute -top-3.5 -right-3 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium",
                            materialAvailable(line)! <= 0
                              ? "bg-destructive/10 text-destructive"
                              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                          )}
                        >
                          {formatNumber(materialAvailable(line)!)}
                        </span>
                      </Hint>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {line.component_type === "none" ? (
                  <span className="text-muted-foreground-subtle">-</span>
                ) : (
                  <NumberInput
                    value={String(line.quantity)}
                    onChange={(v) => onUpdateQuantity(key, Number(v))}
                    className="w-24 text-right text-xs"
                  />
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground-subtle">
                {materialCost(line) != null ? `¥${formatNumber(materialCost(line)!)}` : "-"}
              </TableCell>
              <TableCell>
                <Button variant="destructive" size="sm" onClick={() => onRemove(key)}>
                  削除
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      {showTotalCost && (
        <TableFooter>
          <TableRow>
            <TableCell colSpan={(selectable ? 1 : 0) + (showChoice ? 1 : 0) + 2} className="text-right text-muted-foreground">
              見積原価
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              ¥{formatNumber(lines.reduce((sum, l) => sum + (materialCost(l) ?? 0), 0))}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
