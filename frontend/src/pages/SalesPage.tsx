import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSalesSummary } from "../api/client";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

const PERIOD_OPTIONS = [
  { value: 7, label: "直近7日" },
  { value: 30, label: "直近30日" },
  { value: 90, label: "直近90日" },
];

const DATE_BASIS_OPTIONS = [
  { value: "dispatched" as const, label: "発送日基準" },
  { value: "ordered" as const, label: "注文日基準" },
];

const selectClass =
  "h-8 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function yen(value: number): string {
  return `¥${formatNumber(Math.round(value))}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function dateBasisLabel(dateBasis: "dispatched" | "ordered"): string {
  return dateBasis === "ordered" ? "注文日" : "発送日";
}

// 「直近N日」の見出しに対して実際にN日分の目盛りを出す(データが無い日は0で埋める)。
// バックエンドの日付集計は選択中の基準(発送日/注文日)のUTC暦日基準のため、こちらもUTCの暦日で揃える
function buildDateRange(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// 原価+粗利=売上になるよう積み上げ棒グラフで表示する(内訳の関係が一目で分かるように)
const revenueBreakdownChartConfig: ChartConfig = {
  cost: { label: "原価", color: "var(--chart-5)" },
  grossProfit: { label: "粗利", color: "var(--chart-accent-2)" },
};

const orderCountChartConfig: ChartConfig = {
  orderCount: { label: "注文件数", color: "var(--chart-accent)" },
};

const marginRateChartConfig: ChartConfig = {
  marginRate: { label: "粗利率", color: "var(--chart-3)" },
};

const PRODUCT_METRIC_OPTIONS = [
  { value: "revenue" as const, label: "売上" },
  { value: "quantity" as const, label: "件数" },
];

const productMetricChartConfig: Record<"revenue" | "quantity", ChartConfig> = {
  revenue: { revenue: { label: "売上", color: "var(--chart-accent)" } },
  quantity: { quantity: { label: "件数", color: "var(--chart-3)" } },
};

const CATEGORY_METRIC_OPTIONS = [
  { value: "revenue" as const, label: "売上" },
  { value: "quantity" as const, label: "件数" },
];

const CHART_TYPE_OPTIONS = [
  { value: "bar" as const, label: "棒グラフ" },
  { value: "pie" as const, label: "円グラフ" },
];

// カテゴリ・商品数は可変のため、ChartConfigの固定キーではなく色配列を順番に割り当てる
const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-accent)",
  "var(--chart-accent-2)",
];

export default function SalesPage() {
  const { shops } = useShopContext();
  const [days, setDays] = useState(30);
  const [productMetric, setProductMetric] = useState<"revenue" | "quantity">("revenue");
  const [categoryMetric, setCategoryMetric] = useState<"revenue" | "quantity">("revenue");
  // カテゴリ名をキーにする("未分類"を含め、1ショップ内でのカテゴリ名は重複しない前提)
  const [productCategoryFilter, setProductCategoryFilter] = useState<string | "all">("all");
  const [productChartType, setProductChartType] = useState<"bar" | "pie">("bar");
  // このページはショップ横断の全体感を見る用途のため、ヘッダーの現在選択ショップとは
  // 独立して「全て/個別」を切り替えられるようにする(既定は全体)
  const [shopFilter, setShopFilter] = useState<number | "all">("all");
  const shopId = shopFilter === "all" ? undefined : shopFilter;
  const [dateBasis, setDateBasis] = useState<"dispatched" | "ordered">("dispatched");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-summary", days, shopId, dateBasis],
    queryFn: () => fetchSalesSummary(days, shopId, dateBasis),
  });

  const chartRows = buildDateRange(days).map((date) => {
    const point = data?.points.find((p) => p.date === date);
    const revenue = point?.revenue ?? 0;
    const grossProfit = point?.gross_profit ?? 0;
    return {
      date: shortDate(date),
      revenue,
      cost: point?.cost ?? 0,
      grossProfit,
      orderCount: point?.order_count ?? 0,
      // 売上が0の日は粗利率が定義できない(0%と表示すると「その日は赤字だった」ように
      // 誤解されるため)。nullにしてグラフ上は線を引かず、途切れさせて「データなし」を表す
      marginRate: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
    };
  });
  const dateAxisTickInterval = Math.max(0, Math.ceil(chartRows.length / 10) - 1);

  // カテゴリを選んでいる場合はそのカテゴリ内の商品(バックエンドが商品別に内訳済み)、
  // 「すべて」の場合は全体の商品別ランキング(上位10件)を使う
  const selectedCategory =
    productCategoryFilter === "all" ? null : data?.categories.find((c) => c.name === productCategoryFilter);
  const productSourceRows =
    productCategoryFilter === "all" ? (data?.products ?? []) : (selectedCategory?.products ?? []);

  // 横棒グラフは配列の先頭が上に描画されるため、表示中の指標(売上/件数)が多い順に
  // ソートするだけで上から降順に並ぶ
  const productChartRows = [...productSourceRows]
    .sort((a, b) => b[productMetric] - a[productMetric])
    .map((p) => ({ name: p.title ?? p.item_id, revenue: p.revenue, quantity: p.quantity }));

  // 円グラフの構成比の分母。カテゴリ選択中はそのカテゴリの合計、未選択時は全体の合計を使う
  // (上位10件しか無くても、選ばれていない商品分も含めた「本来の」割合を示すため)
  const productMetricTotal = selectedCategory
    ? selectedCategory[productMetric]
    : productMetric === "revenue"
      ? (data?.total_revenue ?? 0)
      : (data?.total_quantity ?? 0);
  const productPieRows = productChartRows.map((p) => ({
    name: p.name,
    value: p[productMetric],
    share: productMetricTotal ? Math.round((p[productMetric] / productMetricTotal) * 1000) / 10 : 0,
  }));

  // カテゴリは件数/売上の絶対値ではなく、全体に対する構成比(%)で見せる。1商品が複数
  // カテゴリに属する場合は各カテゴリにその商品の実績をそのまま計上しているため
  // (バックエンド側の仕様)、構成比の合計が100%を超えることがある
  const categoryMetricTotal = categoryMetric === "revenue" ? data?.total_revenue ?? 0 : data?.total_quantity ?? 0;
  const categoryChartRows = [...(data?.categories ?? [])]
    .sort((a, b) => b[categoryMetric] - a[categoryMetric])
    .map((c) => ({
      name: c.name,
      value: c[categoryMetric],
      share: categoryMetricTotal ? Math.round((c[categoryMetric] / categoryMetricTotal) * 1000) / 10 : 0,
    }));

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">売上</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            発送確定した注文をもとにした売上の集計です(キャンセルされた商品は除きます)
          </p>
        </div>
        <div className="flex items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sales-shop">ショップ</Label>
            <select
              id="sales-shop"
              className={selectClass}
              value={shopFilter}
              onChange={(e) => setShopFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">全て</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sales-period">期間</Label>
            <select
              id="sales-period"
              className={selectClass}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sales-date-basis">日付の基準</Label>
            <select
              id="sales-date-basis"
              className={selectClass}
              value={dateBasis}
              onChange={(e) => setDateBasis(e.target.value as "dispatched" | "ordered")}
            >
              {DATE_BASIS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {dateBasis === "ordered" && (
        <p className="mb-6 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          注文日基準では、対象は発送確定済みの注文のみのまま、日付だけ注文日で集計します。直近の日はまだ発送し終わっていない分があるため実際より少なく表示され、発送が進むにつれて後から数字が積み上がります。
        </p>
      )}

      {error && (
        <p className="mb-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          読み込みに失敗しました: {(error as Error).message}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>総売上</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {isLoading ? "-" : yen(data?.total_revenue ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>注文件数</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {isLoading ? "-" : formatNumber(data?.order_count ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>平均注文単価</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {isLoading ? "-" : yen(data?.average_order_value ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>総原価</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {isLoading ? "-" : yen(data?.total_cost ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>総粗利</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {isLoading ? "-" : yen(data?.total_gross_profit ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>粗利率</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {isLoading ? "-" : `${((data?.gross_margin_rate ?? 0) * 100).toFixed(1)}%`}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground-subtle">
        <p>原価は部品/中間品に単価を設定した場合のみ計算されます(未設定の部品/中間品は0円扱い)。</p>
        <p>
          中間品の原価は現在の設定値(組成の部品原価合計+中間品自身の追加費用)で計算するため、
          原価変更前の古い注文でも常に現在の原価水準での参考値になります。
        </p>
        <p>なお、発送確定時点で部品引当が記録されていない一部の注文は、現在のBOM構成をもとにした参考値です。</p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>売上高の内訳(原価・粗利)</CardTitle>
            <CardDescription>{dateBasisLabel(dateBasis)}ごとの売上高を原価と粗利の積み上げで見る(棒の高さ=売上)</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!isLoading && (
              <ChartContainer config={revenueBreakdownChartConfig} className="aspect-auto h-72 w-full">
                <BarChart data={chartRows}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} interval={dateAxisTickInterval} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(v: number) => formatNumber(v)}
                  />
                  <ChartTooltip content={<ChartTooltipContent formatter={(value) => yen(Number(value))} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="cost" stackId="revenue" fill="var(--color-cost)" radius={[0, 0, 2, 2]} />
                  <Bar dataKey="grossProfit" stackId="revenue" fill="var(--color-grossProfit)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>注文件数推移</CardTitle>
            <CardDescription>{dateBasisLabel(dateBasis)}ごとの注文件数</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!isLoading && (
              <ChartContainer config={orderCountChartConfig} className="aspect-auto h-72 w-full">
                <BarChart data={chartRows}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} interval={dateAxisTickInterval} />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => `${formatNumber(Number(value))}件`} />}
                  />
                  <Bar dataKey="orderCount" fill="var(--color-orderCount)" radius={3} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>粗利率推移</CardTitle>
            <CardDescription>{dateBasisLabel(dateBasis)}ごとの粗利率</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!isLoading && (
              <ChartContainer config={marginRateChartConfig} className="aspect-auto h-56 w-full">
                <LineChart data={chartRows}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} interval={dateAxisTickInterval} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent formatter={(value) => (value == null ? "売上なし" : `${value}%`)} />}
                  />
                  <Line
                    type="monotone"
                    dataKey="marginRate"
                    stroke="var(--color-marginRate)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "var(--color-marginRate)", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10">
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedCategory ? `「${selectedCategory.name}」の` : ""}
              商品別{productMetric === "revenue" ? "売上" : "件数"}グラフ
            </CardTitle>
            <CardDescription>
              {selectedCategory ? `カテゴリ内で` : ""}
              {productMetric === "revenue" ? "売上" : "件数"}が多い商品(上位{formatNumber(10)}件)
            </CardDescription>
            <CardAction>
              <div className="flex items-center gap-2">
                <select
                  aria-label="カテゴリで絞り込み"
                  className={selectClass}
                  value={productCategoryFilter}
                  onChange={(e) => setProductCategoryFilter(e.target.value)}
                >
                  <option value="all">すべてのカテゴリ</option>
                  {(data?.categories ?? []).map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1 rounded-lg border p-0.5">
                  {PRODUCT_METRIC_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setProductMetric(opt.value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        productMetric === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 rounded-lg border p-0.5">
                  {CHART_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setProductChartType(opt.value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        productChartType === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!isLoading && productChartRows.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">この期間の売上はまだありません。</p>
            )}
            {!isLoading && productChartRows.length > 0 && productChartType === "bar" && (
              <ChartContainer
                config={productMetricChartConfig[productMetric]}
                className="w-full"
                style={{ height: Math.max(160, productChartRows.length * 40) }}
              >
                <BarChart data={productChartRows} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={280}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: string) => (v.length > 28 ? `${v.slice(0, 28)}…` : v)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          productMetric === "revenue" ? yen(Number(value)) : `${formatNumber(Number(value))}件`
                        }
                      />
                    }
                  />
                  <Bar dataKey={productMetric} fill={`var(--color-${productMetric})`} radius={3} />
                </BarChart>
              </ChartContainer>
            )}
            {!isLoading && productChartRows.length > 0 && productChartType === "pie" && (
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
                <ChartContainer config={{}} className="aspect-square h-64 w-full max-w-64 shrink-0">
                  <PieChart>
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          hideLabel
                          formatter={(value, _name, item) => {
                            const row = item.payload as { name: string; value: number };
                            const detail =
                              productMetric === "revenue" ? yen(row.value) : `${formatNumber(row.value)}件`;
                            return `${row.name}: ${value}% (${detail})`;
                          }}
                        />
                      }
                    />
                    <Pie data={productPieRows} dataKey="share" nameKey="name" innerRadius={50} outerRadius={90} strokeWidth={2}>
                      {productPieRows.map((row, i) => (
                        <Cell key={row.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="w-full min-w-0 space-y-2 self-center">
                  {productPieRows.map((p, i) => (
                    <li key={p.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground-subtle">
                        {p.share}% ({productMetric === "revenue" ? yen(p.value) : `${formatNumber(p.value)}件`})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10">
        <Card>
          <CardHeader>
            <CardTitle>カテゴリ別{categoryMetric === "revenue" ? "売上" : "件数"}構成比</CardTitle>
            <CardDescription>
              商品カテゴリごとの{categoryMetric === "revenue" ? "売上" : "件数"}の割合
            </CardDescription>
            <CardAction>
              <select
                aria-label="表示する指標"
                className={selectClass}
                value={categoryMetric}
                onChange={(e) => setCategoryMetric(e.target.value as "revenue" | "quantity")}
              >
                {CATEGORY_METRIC_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </CardAction>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!isLoading && categoryChartRows.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">この期間の売上はまだありません。</p>
            )}
            {!isLoading && categoryChartRows.length > 0 && (
              <>
                <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
                  <ChartContainer config={{}} className="aspect-square h-64 w-full max-w-64 shrink-0">
                    <PieChart>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            hideLabel
                            formatter={(value, _name, item) => {
                              const row = item.payload as { name: string; value: number };
                              const detail =
                                categoryMetric === "revenue" ? yen(row.value) : `${formatNumber(row.value)}件`;
                              return `${row.name}: ${value}% (${detail})`;
                            }}
                          />
                        }
                      />
                      <Pie
                        data={categoryChartRows}
                        dataKey="share"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={90}
                        strokeWidth={2}
                      >
                        {categoryChartRows.map((row, i) => (
                          <Cell key={row.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <ul className="w-full min-w-0 space-y-2 self-center">
                    {categoryChartRows.map((c, i) => (
                      <li key={c.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground-subtle">
                          {c.share}% ({categoryMetric === "revenue" ? yen(c.value) : `${formatNumber(c.value)}件`})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-4 text-xs text-muted-foreground-subtle">
                  1つの商品が複数カテゴリに属する場合、該当する各カテゴリに実績をそのまま計上するため、
                  構成比の合計が100%を超えることがあります。カテゴリが未設定の商品は「未分類」としてまとめています。
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10">
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>商品別ランキング</CardTitle>
            <CardDescription>売上が多い商品(上位{formatNumber(10)}件)</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>}
            {!isLoading && (data?.products.length ?? 0) === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">この期間の売上はまだありません。</p>
            )}
            {!isLoading && data && data.products.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>商品</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">売上</TableHead>
                    <TableHead className="text-right">原価</TableHead>
                    <TableHead className="text-right">粗利</TableHead>
                    <TableHead className="text-right">粗利率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.products.map((p) => (
                    <TableRow key={p.item_id}>
                      <TableCell>
                        <div className="font-medium">{p.title ?? p.item_id}</div>
                        <div className="font-mono text-xs text-muted-foreground-subtle">{p.item_id}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(p.quantity)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{yen(p.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground-subtle">
                        {yen(p.cost)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{yen(p.gross_profit)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground-subtle">
                        {(p.gross_margin_rate * 100).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
