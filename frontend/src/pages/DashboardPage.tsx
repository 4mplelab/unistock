import { useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPurchaseOrder,
  fetchAssemblies,
  fetchAssemblyBuildSummary,
  fetchConsumptionSummary,
  fetchEventLogs,
  fetchLeadTimeSummary,
  fetchNavCounts,
  fetchParts,
  fetchPurchaseOrders,
  fetchReorderNeeded,
  fetchSalesSummary,
  fetchSchedules,
} from "../api/client";
import type { ReorderNeeded } from "../types/purchase_order";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { daysElapsed, isOverdue } from "@/lib/purchaseOrder";
import { formatNumber } from "@/lib/format";
import { EVENT_LOG_CATEGORY_LABEL, EVENT_LOG_LEVEL_CLASS, EVENT_LOG_LEVEL_LABEL } from "@/lib/eventLog";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Clock,
  ExternalLink,
  Layers,
  ListChecks,
  type LucideIcon,
  PackageSearch,
  Truck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Hint from "@/components/Hint";
import ComponentLabel from "@/components/ComponentLabel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function yen(value: number): string {
  return `¥${formatNumber(Math.round(value))}`;
}

// 「直近N日」の見出しに対して実際にN日分の目盛りを出す(データが無い日は0で埋める)。
// バックエンドの日付集計はUTCのdate_trunc('day', ...)基準のため、こちらもUTCの暦日で揃える
function buildDateRange(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// 発注リードタイムのビン。件数が少ない運用規模を想定し、固定の日数区分で
// 集計する(区分の形が毎回変わると推移を比較しづらいため)
const LEAD_TIME_BINS: { label: string; test: (days: number) => boolean }[] = [
  { label: "0-1日", test: (d) => d <= 1 },
  { label: "2-3日", test: (d) => d >= 2 && d <= 3 },
  { label: "4-7日", test: (d) => d >= 4 && d <= 7 },
  { label: "8-14日", test: (d) => d >= 8 && d <= 14 },
  { label: "15-30日", test: (d) => d >= 15 && d <= 30 },
  { label: "31日以上", test: (d) => d >= 31 },
];

const ICON_BADGE_CLASS = {
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  red: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  indigo: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  purple: "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400",
  teal: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
  cyan: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400",
} as const;

function CardIconBadge({ icon: Icon, color }: { icon: LucideIcon; color: keyof typeof ICON_BADGE_CLASS }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", ICON_BADGE_CLASS[color])}>
      <Icon className="size-[18px]" />
    </span>
  );
}

function ProgressRing({
  percent,
  fromClassName,
  toClassName,
  size = 84,
  strokeWidth = 8,
}: {
  percent: number;
  fromClassName: string;
  toClassName: string;
  size?: number;
  strokeWidth?: number;
}) {
  const gradientId = useId();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="currentColor" className={fromClassName} />
            <stop offset="100%" stopColor="currentColor" className={toClassName} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute text-xl font-bold tabular-nums">{clamped}%</span>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentShopId, currentShop } = useShopContext();
  const [orderTarget, setOrderTarget] = useState<ReorderNeeded | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [orderUrl, setOrderUrl] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["reorder-needed"],
    queryFn: fetchReorderNeeded,
  });

  const openOrdersQuery = useQuery({
    queryKey: ["purchase-orders", "dashboard-open"],
    queryFn: () => fetchPurchaseOrders(50, 0, "ordered"),
  });

  const salesSummaryQuery = useQuery({
    queryKey: ["sales-summary", "dashboard", currentShopId],
    queryFn: () => fetchSalesSummary(30, currentShopId ?? undefined),
  });

  // リストック予約はBASEショップにしか存在しない機能のため、対象外プラットフォームの
  // ショップを見ているときはそもそも問い合わせない(カード自体も表示しない)
  const showRestockCard = currentShop?.platform === "base";
  const pendingSchedulesQuery = useQuery({
    queryKey: ["schedules", "dashboard-pending", currentShopId],
    queryFn: () => fetchSchedules(5, 0, currentShopId ?? undefined, "pending"),
    enabled: showRestockCard,
  });

  const navCountsQuery = useQuery({
    queryKey: ["nav-counts", "dashboard", currentShopId],
    queryFn: () => fetchNavCounts(currentShopId ?? undefined),
  });

  const recentEventLogsQuery = useQuery({
    queryKey: ["event-logs", "dashboard-recent", currentShopId],
    queryFn: () => fetchEventLogs(5, 0, undefined, currentShopId ?? undefined),
  });

  const partsQuery = useQuery({ queryKey: ["parts", "dashboard"], queryFn: fetchParts });
  const assembliesQuery = useQuery({ queryKey: ["assemblies", "dashboard"], queryFn: fetchAssemblies });

  const consumptionQuery = useQuery({
    queryKey: ["consumption-summary", "dashboard"],
    queryFn: () => fetchConsumptionSummary(30, 5),
  });

  const leadTimeQuery = useQuery({
    queryKey: ["lead-time-summary", "dashboard"],
    queryFn: fetchLeadTimeSummary,
  });

  const assemblyBuildQuery = useQuery({
    queryKey: ["assembly-build-summary", "dashboard"],
    queryFn: () => fetchAssemblyBuildSummary(30),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!orderTarget) throw new Error("部品が選択されていません");
      if (currentShopId == null) throw new Error("ショップが選択されていません");
      return createPurchaseOrder({
        part_id: orderTarget.id,
        shop_id: currentShopId,
        quantity,
        expected_delivery_date: expectedDeliveryDate || null,
        order_url: orderUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reorder-needed"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["nav-counts"] });
      setOrderTarget(null);
    },
  });

  function openOrderDialog(item: ReorderNeeded) {
    setQuantity(Math.max(1, item.reorder_threshold - item.available));
    setExpectedDeliveryDate("");
    setOrderUrl("");
    setOrderTarget(item);
  }

  const negativeStockItems = useMemo(() => {
    const parts = (partsQuery.data ?? [])
      .filter((p) => p.available < 0)
      .map((p) => ({
        kind: "part" as const,
        id: p.id,
        name: p.name,
        available: p.available,
        group: p.group,
        colors: p.colors,
        tags: p.tags,
      }));
    const assemblies = (assembliesQuery.data ?? [])
      .filter((a) => a.available < 0)
      .map((a) => ({
        kind: "assembly" as const,
        id: a.id,
        name: a.name,
        available: a.available,
        group: a.group,
        colors: null,
        tags: a.tags,
      }));
    return [...parts, ...assemblies].sort((a, b) => a.available - b.available);
  }, [partsQuery.data, assembliesQuery.data]);

  const consumptionChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    (consumptionQuery.data?.series ?? []).forEach((s, i) => {
      config[`${s.component_type}_${s.component_id}`] = {
        label: s.component_name,
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    });
    return config;
  }, [consumptionQuery.data]);

  const consumptionChartRows = useMemo(() => {
    const series = consumptionQuery.data?.series ?? [];
    const dates = buildDateRange(consumptionQuery.data?.days ?? 30);
    return dates.map((date) => {
      const row: Record<string, string | number> = { date: shortDate(date) };
      series.forEach((s) => {
        const key = `${s.component_type}_${s.component_id}`;
        const point = s.points.find((p) => p.date === date);
        row[key] = point?.quantity ?? 0;
      });
      return row;
    });
  }, [consumptionQuery.data]);

  const leadTimeChartRows = useMemo(() => {
    const days = leadTimeQuery.data?.lead_times_days ?? [];
    return LEAD_TIME_BINS.map((bin) => ({
      bin: bin.label,
      count: days.filter(bin.test).length,
    }));
  }, [leadTimeQuery.data]);

  const assemblyBuildChartRows = useMemo(() => {
    const dates = buildDateRange(assemblyBuildQuery.data?.days ?? 30);
    return dates.map((date) => ({
      date: shortDate(date),
      quantity: assemblyBuildQuery.data?.points.find((p) => p.date === date)?.quantity ?? 0,
    }));
  }, [assemblyBuildQuery.data]);

  // 30日分の目盛りをそのまま出すと重なるため、ラベルは一定間隔で間引く
  const dateAxisTickInterval = Math.max(0, Math.ceil(consumptionChartRows.length / 10) - 1);

  const leadTimeChartConfig: ChartConfig = { count: { label: "件数", color: "var(--chart-accent)" } };
  const assemblyBuildChartConfig: ChartConfig = { quantity: { label: "組立数量", color: "var(--chart-accent-2)" } };

  const pickingIncomplete = navCountsQuery.data?.picking_incomplete ?? 0;
  const ordersUnaddressed = navCountsQuery.data?.orders_unaddressed ?? 0;
  const pickingCompletionPercent =
    ordersUnaddressed > 0 ? Math.round(((ordersUnaddressed - pickingIncomplete) / ordersUnaddressed) * 100) : 0;

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted-foreground-subtle">在庫・注文・部品の状況サマリー</p>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <Card className="flex h-full flex-col pb-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={AlertTriangle} color="amber" />
              <div className="min-w-0">
                <CardTitle>発注が必要な部品</CardTitle>
                <CardDescription>発注点(利用可能数の下限)を下回った部品</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {error && (
              <p className="py-8 text-center text-sm text-destructive">
                読み込みに失敗しました: {(error as Error).message}
              </p>
            )}
            {!isLoading && !error && (!data || data.length === 0) && (
              <p className="py-8 text-center text-sm text-muted-foreground">発注が必要な部品はありません。</p>
            )}
            {!isLoading && !error && data && data.length > 0 && (
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {data.map((item) => (
                  <div
                    key={item.id}
                    className="flex cursor-pointer items-center justify-between gap-3 px-6 py-4 hover:bg-muted/50"
                    onClick={() => navigate(`/parts/${item.id}/edit`)}
                  >
                    <div className="min-w-0 text-sm">
                      {item.purchase_url ? (
                        <Hint label="購入先を開く">
                          <a
                            href={item.purchase_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="group inline-flex min-w-0 items-center gap-1 text-primary"
                          >
                            <ComponentLabel name={item.name} group={item.group} colors={item.colors} tags={item.tags} />
                            <ExternalLink className="size-3 shrink-0 text-muted-foreground-subtle" />
                          </a>
                        </Hint>
                      ) : (
                        <ComponentLabel name={item.name} group={item.group} colors={item.colors} tags={item.tags} />
                      )}
                    </div>
                    <div
                      className="flex shrink-0 flex-col items-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="whitespace-nowrap text-xs text-muted-foreground-subtle">
                        在庫 {formatNumber(item.stock)} / 発注点 {formatNumber(item.reorder_threshold)}
                      </span>
                      {item.has_open_order ? (
                        <Badge className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                          発注中
                        </Badge>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => openOrderDialog(item)}>
                          発注する
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col pb-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={Truck} color="blue" />
              <div className="min-w-0">
                <CardTitle>発注中</CardTitle>
                <CardDescription>まだ入荷していない発注。納期を過ぎているものは赤字で表示します</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            {openOrdersQuery.isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>
            )}
            {openOrdersQuery.error && (
              <p className="py-8 text-center text-sm text-destructive">
                読み込みに失敗しました: {(openOrdersQuery.error as Error).message}
              </p>
            )}
            {!openOrdersQuery.isLoading && !openOrdersQuery.error && openOrdersQuery.data?.items.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">発注中の部品はありません。</p>
            )}
            {!openOrdersQuery.isLoading && !openOrdersQuery.error && openOrdersQuery.data && openOrdersQuery.data.items.length > 0 && (
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {openOrdersQuery.data.items.map((o) => {
                  const overdue = isOverdue(o.expected_delivery_date);
                  return (
                    <Link
                      key={o.id}
                      to="/purchase-orders"
                      className={cn(
                        "flex items-center justify-between gap-3 px-6 py-4 text-sm hover:bg-muted/50",
                        overdue && "text-destructive"
                      )}
                    >
                      <span className={cn("min-w-0 truncate", !overdue && "font-medium")}>
                        {o.part_name} × {formatNumber(o.quantity)}
                      </span>
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-3 whitespace-nowrap",
                          overdue ? "text-destructive" : "text-muted-foreground-subtle"
                        )}
                      >
                        <span className="w-24 text-right">
                          {o.expected_delivery_date
                            ? `納期 ${formatDate(o.expected_delivery_date)}`
                            : "-"}
                        </span>
                        <span className="w-14 text-right">経過{daysElapsed(o.ordered_at)}日</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <Card className="flex h-full flex-col pb-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CardIconBadge icon={TrendingUp} color="teal" />
                <div className="min-w-0">
                  <CardTitle>売上サマリ</CardTitle>
                  <CardDescription>直近30日の発送確定分</CardDescription>
                </div>
              </div>
              <Link to="/sales" className="shrink-0 text-xs text-muted-foreground-subtle hover:underline">
                詳しく見る
              </Link>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center gap-6 pb-6">
            {salesSummaryQuery.isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>
            )}
            {salesSummaryQuery.error && (
              <p className="py-8 text-center text-sm text-destructive">
                読み込みに失敗しました: {(salesSummaryQuery.error as Error).message}
              </p>
            )}
            {salesSummaryQuery.data && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground-subtle">総売上</p>
                  <p className="text-3xl font-bold tabular-nums">{yen(salesSummaryQuery.data.total_revenue)}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground-subtle">粗利率</p>
                    <p className="font-semibold tabular-nums">
                      {Math.round(salesSummaryQuery.data.gross_margin_rate * 100)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground-subtle">注文件数</p>
                    <p className="font-semibold tabular-nums">{formatNumber(salesSummaryQuery.data.order_count)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground-subtle">平均注文単価</p>
                    <p className="font-semibold tabular-nums">{yen(salesSummaryQuery.data.average_order_value)}</p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col pb-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={TrendingDown} color="red" />
              <div className="min-w-0">
                <CardTitle>マイナス在庫の警告</CardTitle>
                <CardDescription>利用可能数が0未満になっている部品・中間品</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            {(partsQuery.isLoading || assembliesQuery.isLoading) && (
              <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>
            )}
            {!partsQuery.isLoading && !assembliesQuery.isLoading && negativeStockItems.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                マイナス在庫の部品・中間品はありません。
              </p>
            )}
            {!partsQuery.isLoading && !assembliesQuery.isLoading && negativeStockItems.length > 0 && (
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {negativeStockItems.map((item) => (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className="flex cursor-pointer items-center justify-between gap-3 px-6 py-4 text-sm hover:bg-muted/50"
                    onClick={() => navigate(item.kind === "part" ? `/parts/${item.id}/edit` : `/assemblies/${item.id}/edit`)}
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <ComponentLabel name={item.name} group={item.group} colors={item.colors} tags={item.tags} />
                      {item.kind === "assembly" && (
                        <span className="shrink-0 text-xs font-normal text-muted-foreground-subtle">(中間品)</span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-destructive">{formatNumber(item.available)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={cn("mt-10 grid gap-10", showRestockCard ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        <Card className="flex h-full flex-col">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={ListChecks} color="emerald" />
              <div className="min-w-0">
                <CardTitle>ピッキング状況</CardTitle>
                <CardDescription>未対応の注文と、そのピッキング進捗</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center gap-4">
            {navCountsQuery.isLoading && <p className="text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!navCountsQuery.isLoading && (
              <>
                <div className="flex items-center justify-center gap-6">
                  <ProgressRing
                    percent={pickingCompletionPercent}
                    fromClassName="text-emerald-400"
                    toClassName="text-emerald-600"
                  />
                  <div className="grid gap-3">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">{formatNumber(ordersUnaddressed)}</div>
                      <div className="text-xs text-muted-foreground-subtle">未対応の注文</div>
                    </div>
                    <div>
                      <div
                        className={cn(
                          "text-2xl font-semibold tabular-nums",
                          pickingIncomplete > 0 && "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {formatNumber(pickingIncomplete)}
                      </div>
                      <div className="text-xs text-muted-foreground-subtle">ピッキング未完了</div>
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/picking")}>
                  ピッキングを開く
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col pb-0">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={Bell} color="violet" />
              <div className="min-w-0">
                <CardTitle>直近のイベントログ</CardTitle>
                <CardDescription>引当スキップ・在庫操作失敗など、確認が必要な業務イベント</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col p-0">
            {recentEventLogsQuery.isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>
            )}
            {!recentEventLogsQuery.isLoading && recentEventLogsQuery.data?.items.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">イベントはまだありません。</p>
            )}
            {!recentEventLogsQuery.isLoading && recentEventLogsQuery.data && recentEventLogsQuery.data.items.length > 0 && (
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {recentEventLogsQuery.data.items.map((log) => (
                  <Link
                    key={log.id}
                    to={`/event-logs?highlight=${log.id}`}
                    className="flex flex-col gap-1 px-6 py-3 text-sm hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className={cn("border-transparent", EVENT_LOG_LEVEL_CLASS[log.level])}>
                        {EVENT_LOG_LEVEL_LABEL[log.level] ?? log.level}
                      </Badge>
                      <span className="text-xs text-muted-foreground-subtle">
                        {EVENT_LOG_CATEGORY_LABEL[log.category] ?? log.category}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground-subtle">
                        {formatDate(log.last_occurred_at)}
                        {log.occurrence_count > 1 && ` (${log.occurrence_count}回)`}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-muted-foreground">{log.message}</p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {showRestockCard && (
          <Card className="flex h-full flex-col pb-0">
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardIconBadge icon={PackageSearch} color="cyan" />
                <div className="min-w-0">
                  <CardTitle>リストック予約</CardTitle>
                  <CardDescription>まだ実行されていない在庫プッシュ予約(実行日時が近い順)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              {pendingSchedulesQuery.isLoading && (
                <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>
              )}
              {pendingSchedulesQuery.error && (
                <p className="py-8 text-center text-sm text-destructive">
                  読み込みに失敗しました: {(pendingSchedulesQuery.error as Error).message}
                </p>
              )}
              {!pendingSchedulesQuery.isLoading &&
                !pendingSchedulesQuery.error &&
                pendingSchedulesQuery.data?.items.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">実行待ちの予約はありません。</p>
                )}
              {!pendingSchedulesQuery.isLoading &&
                !pendingSchedulesQuery.error &&
                pendingSchedulesQuery.data &&
                pendingSchedulesQuery.data.items.length > 0 && (
                  <div className="divide-y divide-border">
                    {pendingSchedulesQuery.data.items.map((s) => (
                      <Link
                        key={s.id}
                        to="/schedules"
                        className="flex items-center justify-between gap-3 px-6 py-4 text-sm hover:bg-muted/50"
                      >
                        <span className="min-w-0 truncate font-medium">{s.item_name ?? s.item_id}</span>
                        <span className="flex shrink-0 items-center gap-3 whitespace-nowrap text-muted-foreground-subtle">
                          <span>在庫{formatNumber(s.target_stock)}へ</span>
                          <span className="w-36 text-right">{formatDateTime(s.run_at)}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-10">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={BarChart3} color="indigo" />
              <div className="min-w-0">
                <CardTitle>部品消費トレンド</CardTitle>
                <CardDescription>直近30日で消費数量が多い部品・中間品(上位5件)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {consumptionQuery.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!consumptionQuery.isLoading && (consumptionQuery.data?.series.length ?? 0) === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">直近30日の消費データはありません。</p>
            )}
            {!consumptionQuery.isLoading && (consumptionQuery.data?.series.length ?? 0) > 0 && (
              <ChartContainer config={consumptionChartConfig} className="aspect-auto h-80 w-full">
                <BarChart data={consumptionChartRows} barCategoryGap="40%">
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} interval={dateAxisTickInterval} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {Object.keys(consumptionChartConfig).map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="a"
                      fill={`var(--color-${key})`}
                      fillOpacity={0.55}
                      maxBarSize={32}
                    />
                  ))}
                  <ChartLegend content={<ChartLegendContent />} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={Clock} color="sky" />
              <div className="min-w-0">
                <CardTitle>発注リードタイム分布</CardTitle>
                <CardDescription>発注から入荷までの実績日数(入荷済みの発注のみ)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {leadTimeQuery.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!leadTimeQuery.isLoading && (leadTimeQuery.data?.lead_times_days.length ?? 0) === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">入荷済みの発注実績がまだありません。</p>
            )}
            {!leadTimeQuery.isLoading && (leadTimeQuery.data?.lead_times_days.length ?? 0) > 0 && (
              <ChartContainer config={leadTimeChartConfig} className="aspect-auto h-64 w-full">
                <AreaChart data={leadTimeChartRows}>
                  <defs>
                    <linearGradient id="leadTimeAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bin" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="var(--color-count)"
                    strokeWidth={2.5}
                    fill="url(#leadTimeAreaFill)"
                    dot={{ r: 3, fill: "var(--color-count)", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardIconBadge icon={Layers} color="purple" />
              <div className="min-w-0">
                <CardTitle>中間品組立稼働状況</CardTitle>
                <CardDescription>直近30日の組立数量の推移</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {assemblyBuildQuery.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!assemblyBuildQuery.isLoading && (assemblyBuildQuery.data?.points.length ?? 0) === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">直近30日の組立記録はありません。</p>
            )}
            {!assemblyBuildQuery.isLoading && (assemblyBuildQuery.data?.points.length ?? 0) > 0 && (
              <ChartContainer config={assemblyBuildChartConfig} className="aspect-auto h-64 w-full">
                <AreaChart data={assemblyBuildChartRows}>
                  <defs>
                    <linearGradient id="assemblyBuildAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-quantity)" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="var(--color-quantity)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} interval={dateAxisTickInterval} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="quantity"
                    stroke="var(--color-quantity)"
                    strokeWidth={2.5}
                    fill="url(#assemblyBuildAreaFill)"
                    dot={{ r: 3, fill: "var(--color-quantity)", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!orderTarget} onOpenChange={(open) => !open && setOrderTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>発注する</DialogTitle>
            <DialogDescription>「{orderTarget?.name}」の発注数量を入力してください。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="order_quantity">数量</Label>
            <NumberInput
              id="order_quantity"
              value={String(quantity)}
              onChange={(v) => setQuantity(Number(v))}
              className="w-32 text-right"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="order_expected_delivery_date">納品予定日</Label>
            <Input
              id="order_expected_delivery_date"
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="order_url">発注URL</Label>
            <Input
              id="order_url"
              value={orderUrl}
              onChange={(e) => setOrderUrl(e.target.value)}
              placeholder="発注先のURLを貼り付け(後からでも入力可)"
            />
          </div>
          {createMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(createMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderTarget(null)}>
              キャンセル
            </Button>
            <Button
              disabled={createMutation.isPending || quantity <= 0 || currentShopId == null}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "発注中..." : "発注する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
