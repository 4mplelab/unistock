import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  HelpCircle,
  History,
  LayoutDashboard,
  Layers,
  ListChecks,
  ListTree,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PackageSearch,
  PencilLine,
  Plus,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Sun,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/datetime";
import LogoMark from "@/components/LogoMark";
import { useTheme, type ThemeMode } from "../theme";
import {
  fetchCurrentUser,
  fetchHealth,
  fetchNavCounts,
  fetchOAuthStatus,
  fetchUpdateCheck,
  logout,
  updateSetting,
} from "../api/client";
import { useShopContext } from "@/contexts/ShopContext";
import ShopSetupFlow from "@/components/ShopSetupFlow";
import type { NavCounts } from "@/types/nav_counts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Hint from "@/components/Hint";
import type { CurrentUser } from "@/types/auth";

const SIDEBAR_COLLAPSED_KEY = "unistock.sidebarCollapsed";
// サイドバーをオーバーレイのドロワーに切り替えるブレークポイント(Tailwindのlg = 1024px)。
// UniStockは横に長いテーブルが多いため、ノートPC程度の幅でもコンテンツに余裕を持たせたい
const DESKTOP_QUERY = "(min-width: 1024px)";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Boxes;
  end: boolean;
  // サイドバーの通知バッジに表示する件数のキー(NavCounts参照)。無ければバッジ無し
  countKey?: keyof NavCounts;
  // バッジの色味。"warning"=対応待ち(amber)、"info"=待機中(indigo、ステータスバッジの
  // 「待機中」表示と同系色)、"critical"=エラー(destructive)。省略時はwarning
  countTone?: "warning" | "info" | "critical";
  // 現在選択中のショップがこのプラットフォームの時だけ表示する(無ければ常に表示)
  platformOnly?: string;
};

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ to: "/", label: "ダッシュボード", icon: LayoutDashboard, end: true }],
  },
  {
    label: "マスタ",
    items: [
      { to: "/parts", label: "部品", icon: Boxes, end: false },
      { to: "/assemblies", label: "中間品", icon: Layers, end: false },
      { to: "/bom", label: "BOM(商品レシピ)", icon: ListTree, end: false },
      {
        to: "/manual-items",
        label: "商品管理(手動)",
        icon: PencilLine,
        end: false,
        platformOnly: "manual",
      },
    ],
  },
  {
    label: "発注",
    items: [
      {
        to: "/purchase-orders",
        label: "発注管理",
        icon: ShoppingCart,
        end: false,
        countKey: "purchase_orders_ordered",
      },
    ],
  },
  {
    label: "ECサイト連携",
    items: [
      {
        to: "/schedules",
        label: "リストック予約",
        icon: PackageSearch,
        end: false,
        countKey: "schedules_pending",
        countTone: "info",
        platformOnly: "base",
      },
    ],
  },
  {
    label: "注文",
    items: [
      { to: "/orders", label: "注文", icon: Receipt, end: false, countKey: "orders_unaddressed" },
      { to: "/picking", label: "ピッキング", icon: ListChecks, end: false, countKey: "picking_incomplete" },
      { to: "/sales", label: "売上", icon: TrendingUp, end: false },
    ],
  },
  {
    label: "履歴",
    items: [
      { to: "/stock-movements", label: "在庫変動履歴", icon: Clock, end: false },
      {
        to: "/event-logs",
        label: "イベントログ",
        icon: History,
        end: false,
        countKey: "event_logs_error",
        countTone: "critical",
      },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { to: "/settings", label: "設定", icon: Settings, end: false };

// アクティブな項目の背景はbg-primary(ライト/ダーク問わず明るい色)になるため、バッジは
// カード等の背景色に馴染ませる半透明配色ではなく、常に自分自身で十分なコントラストを
// 確保できる単色にする(半透明だと、明るいアクティブ背景の上でほぼ見えなくなる)。
// 文字色は「アクティブ/ライトダークで反転」ではなく、各背景色そのものに対して常に
// 読みやすい方(indigo/destructiveは白、amberは黒)で固定する(indigoに黒文字は
// 読みにくかったため、背景ごとの可読性を優先した)
const COUNT_TONE_CLASS: Record<"warning" | "info" | "critical", string> = {
  warning: "bg-amber-500 text-black",
  info: "bg-indigo-500 text-white",
  critical: "bg-destructive text-white",
};
// 非アクティブな項目では、他の一覧画面のステータスバッジと同じ配色(半透明の背景+
// 同系色の文字)にする。アクティブな項目だけは上のCOUNT_TONE_CLASS(不透明)のままにする
// (アクティブ背景がbg-primaryという強い色になるため、半透明だとほぼ見えなくなるため)
const COUNT_TONE_SOFT_CLASS: Record<"warning" | "info" | "critical", string> = {
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  info: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  critical: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive",
};
const COUNT_DOT_TONE_CLASS: Record<"warning" | "info" | "critical", string> = {
  warning: "bg-amber-500",
  info: "bg-indigo-500",
  critical: "bg-destructive",
};

function NavItemLink({
  to,
  label,
  icon: Icon,
  end,
  collapsed,
  count,
  countTone = "warning",
}: NavItem & { collapsed: boolean; count?: number }) {
  const hasCount = !!count && count > 0;
  const { pathname } = useLocation();
  // NavLinkの関数childrenをHint(Radix Tooltip asChild)配下で使うと、折りたたみ時のみ
  // isActive判定に基づくクラスが不安定に(意図しない色で)反映されることがあったため、
  // 現在地の判定は自前でuseLocationから行い、通常のLinkに固定クラスを渡す方式に変更した
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const link = (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        isActive
          ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <span className="relative shrink-0">
        <Icon className="size-4" />
        {/* 折りたたみ時は数字を出すスペースが無いため、通知ドットだけアイコンの角に添える */}
        {collapsed && hasCount && (
          <span
            className={cn(
              "absolute -top-1 -right-1 size-2 rounded-full ring-2 ring-card",
              COUNT_DOT_TONE_CLASS[countTone]
            )}
          />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {hasCount && (
            <span
              className={cn(
                "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                isActive ? COUNT_TONE_CLASS[countTone] : COUNT_TONE_SOFT_CLASS[countTone]
              )}
            >
              {count}
            </span>
          )}
        </>
      )}
    </Link>
  );
  const hintLabel = hasCount ? `${label}(${count}件)` : label;
  return collapsed ? (
    <Hint label={hintLabel} side="right">
      {link}
    </Hint>
  ) : (
    link
  );
}

// サイドバーの折りたたみ切り替え。ヘッダー左端(ロゴの隣)・サイドバー下部の
// どちらに置いても窮屈だったため、サイドバーとコンテンツの境界に小さな丸ボタンとして置き、
// 普段は隠してサイドバーにマウスを乗せたときだけ表示する(Notion等でよくある配置)。
// モバイルのドロワー表示にはこの「折りたたみ」概念自体が無い(ハンバーガー+
// オーバーレイ方式)ため、デスクトップ(lg以上)でのみ表示する
function SidebarCollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <Hint label={collapsed ? "サイドメニューを開く" : "サイドメニューを格納"} side="right">
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "サイドメニューを開く" : "サイドメニューを格納"}
        className="absolute top-6 right-0 z-10 hidden size-6 translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground lg:flex"
      >
        {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
      </button>
    </Hint>
  );
}

const topBarIconButtonClass =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

// 各画面の詳しい使い方(Astro Starlightで構築、同じnginxコンテナが/docs配下で配信)。
// SPAルーティングの対象外の別サイトなので新しいタブで開く
function DocsLinkButton() {
  return (
    <Hint label="使い方ドキュメント">
      <a href="/docs/" target="_blank" rel="noreferrer" className={topBarIconButtonClass}>
        <HelpCircle className="size-4" />
      </a>
    </Hint>
  );
}

const THEME_CYCLE: ThemeMode[] = ["light", "dark", "system"];
const THEME_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABEL: Record<ThemeMode, string> = { light: "ライト", dark: "ダーク", system: "システムに従う" };

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme();
  const Icon = THEME_ICON[theme];

  function cycle() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    setTheme(next);
  }

  return (
    <Hint label={`外観: ${THEME_LABEL[theme]}(クリックで切り替え)`}>
      <button type="button" onClick={cycle} className={topBarIconButtonClass}>
        <Icon className="size-4" />
      </button>
    </Hint>
  );
}

// ヘッダーの通知ベルに出す1件分。「更新あり」以外にも今後種類が増える前提の共通フォーマット
// (タイトル+ホバーで詳細+任意でリンク+任意で×による既読化)にしている
interface AppNotification {
  id: string;
  title: string;
  detail: string;
  tone: "info" | "warning" | "critical";
  link?: { href: string; label: string };
  onDismiss?: () => void;
}

// サイドバーの通知バッジ(COUNT_TONE_CLASS)と同じ配色にする(infoはindigo、
// リストック予約のバッジ・在庫スケジューラーの「待機中」バッジと同系色)
const NOTIFICATION_DOT_TONE_CLASS: Record<AppNotification["tone"], string> = {
  info: "bg-indigo-500",
  warning: "bg-amber-500",
  critical: "bg-destructive",
};

// 新しいバージョンが出ているかどうかの通知。devビルド(未リリースのローカル/PRビルド)では
// fetchUpdateCheckがnullを返すため何も出ない。自動更新はしない(反映は運用者がサーバーで
// 手動で行う)ため、あくまで気づかせるだけ。×はバージョン単位の既読化(サーバー側の設定に
// 保存するので、既読にした後さらに新しいリリースが出れば別バージョンとして再度通知される)
function useAppNotifications(isAdmin: boolean): AppNotification[] {
  const queryClient = useQueryClient();
  const { data: updateCheck } = useQuery({
    queryKey: ["update-check"],
    queryFn: fetchUpdateCheck,
    staleTime: 30 * 60_000,
    enabled: isAdmin,
  });
  const dismissUpdateMutation = useMutation({
    mutationFn: (version: string) => updateSetting("update_check.dismissed_version", version),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["update-check"] }),
  });

  const notifications: AppNotification[] = [];
  if (updateCheck?.update_available) {
    notifications.push({
      id: "update-available",
      title: `新しいバージョンがあります: ${updateCheck.current_version} → ${updateCheck.latest_version}`,
      detail: "自動更新はしません。反映するにはサーバーでdocker compose pullなどを実行してください",
      tone: "info",
      link: { href: updateCheck.release_url, label: "リリースノートを見る" },
      onDismiss: () => dismissUpdateMutation.mutate(updateCheck.latest_version),
    });
    if (updateCheck.config_files_changed) {
      notifications.push({
        id: "config-files-changed",
        title: "docker-compose.yml/.envのサンプルに変更があります",
        detail: "最新版を取得して、手元のファイルと見比べてください",
        tone: "warning",
        link: {
          href: `https://github.com/4mplelab/unistock/compare/${updateCheck.current_version}...${updateCheck.latest_version}`,
          label: "変更内容を見る",
        },
        onDismiss: () => dismissUpdateMutation.mutate(updateCheck.latest_version),
      });
    }
  }
  return notifications;
}

// docker compose pull等、通知に対応できる操作を行えるのは運用者だけなので管理者にのみ表示する
function NotificationBell({ isAdmin }: { isAdmin: boolean }) {
  const notifications = useAppNotifications(isAdmin);

  if (!isAdmin) return null;

  // ベルのドットは、複数の通知があれば一番深刻なtone(critical > warning > info)の色にする
  // (通知の中身に関わらず固定色だと、開くまで深刻度が分からなかったため)
  const topTone: AppNotification["tone"] | null = notifications.some((n) => n.tone === "critical")
    ? "critical"
    : notifications.some((n) => n.tone === "warning")
      ? "warning"
      : notifications.length > 0
        ? "info"
        : null;

  return (
    <DropdownMenu>
      <Hint label={notifications.length > 0 ? `通知${notifications.length}件` : "通知はありません"}>
        <DropdownMenuTrigger className={cn(topBarIconButtonClass, "relative")}>
          <Bell className="size-4" />
          {topTone && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card",
                NOTIFICATION_DOT_TONE_CLASS[topTone]
              )}
            />
          )}
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-80">
        {notifications.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">通知はありません</p>
        )}
        {notifications.map((n, i) => (
          <div key={n.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <div className="flex items-start gap-2 px-2 py-1.5">
              <span
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", NOTIFICATION_DOT_TONE_CLASS[n.tone])}
              />
              <Hint label={n.detail} side="left">
                <div className="min-w-0 flex-1 cursor-default">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.link && (
                    <a
                      href={n.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      {n.link.label}
                    </a>
                  )}
                </div>
              </Hint>
              {n.onDismiss && (
                <Hint label="既読にする">
                  <button
                    type="button"
                    onClick={n.onDismiss}
                    className="shrink-0 rounded p-0.5 text-muted-foreground-subtle hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </Hint>
              )}
            </div>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// デモモード(外部ショップ接続なしのスタンドアロン展示用)であることを常時分かるように表示する。
// 見た目だけの案内であり、実際の権限制御はバックエンド側(settings.demo_mode)で行う
function DemoModeBadge() {
  const { data } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: 60_000 });
  if (!data?.demo_mode) return null;
  return (
    <Hint label="デモモード: ショップ接続なし・ログイン不要で動作中です">
      <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
        デモモード
      </Badge>
    </Hint>
  );
}

// 全ショップの連携(OAuth)状態を横断で表示するインジケーター。認証切れに気づかず
// 同期が止まっていた、という事態を早期に発見できるようにする。ショップが複数でも
// 1つのドットに集約し、詳細は設定画面(ショップごとのカード)で確認する
// ヘッダーのショップ切り替えメニュー。「今どのショップを操作対象にしているか」の
// 唯一の切り替え口(ShopContext参照)。BOM編集・リストック予約作成など
// ショップに紐づく画面は、ここで選んだショップをそのまま使う
function ShopSwitcher({ isAdmin }: { isAdmin: boolean }) {
  const { shops, currentShopId, currentShop, setCurrentShopId } = useShopContext();
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: 60_000 });
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const activeShops = shops.filter((s) => s.is_active);
  const baseShopIds = shops.filter((s) => s.platform === "base").map((s) => s.id);

  const { data: statusMap } = useQuery({
    queryKey: ["shops-oauth-status-map", baseShopIds.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        baseShopIds.map(
          async (id) => [id, await fetchOAuthStatus(id).catch(() => ({ authenticated: false }))] as const
        )
      );
      return new Map(entries);
    },
    enabled: baseShopIds.length > 0,
    refetchInterval: 5 * 60 * 1000,
  });

  const currentConnected =
    currentShop == null ? null : statusMap?.get(currentShop.id)?.authenticated ?? null;

  function handleCreated(shopId: number) {
    setCurrentShopId(shopId);
    setAddDialogOpen(false);
  }

  const addDialog = (
    <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ショップを追加</DialogTitle>
        </DialogHeader>
        <ShopSetupFlow demoMode={health?.demo_mode ?? false} onDone={handleCreated} />
      </DialogContent>
    </Dialog>
  );

  if (shops.length === 0) {
    if (!isAdmin) {
      return (
        <Hint label="ショップが未登録です。管理者に追加を依頼してください">
          <span className={cn(topBarIconButtonClass, "w-auto cursor-default gap-1.5 px-2 text-xs font-medium")}>
            <Store className="size-4" />
            ショップ未登録
          </span>
        </Hint>
      );
    }
    return (
      <>
        <Hint label="操作対象のショップがまだありません">
          <button
            type="button"
            onClick={() => setAddDialogOpen(true)}
            className={cn(topBarIconButtonClass, "w-auto gap-1.5 px-2 text-xs font-medium")}
          >
            <Plus className="size-4" />
            ショップを追加
          </button>
        </Hint>
        {addDialog}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <Hint label="操作対象のショップを切り替える">
          <DropdownMenuTrigger className={cn(topBarIconButtonClass, "w-auto gap-1.5 px-2")}>
            <Store className="size-4 shrink-0" />
            <span className="max-w-32 truncate text-xs font-medium">
              {currentShop?.name ?? "ショップ未選択"}
            </span>
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                currentConnected == null
                  ? "bg-muted-foreground/40"
                  : currentConnected
                    ? "bg-emerald-500"
                    : "bg-destructive"
              )}
            />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-56">
          {activeShops.map((s) => (
            <DropdownMenuItem key={s.id} onClick={() => setCurrentShopId(s.id)}>
              <span className="flex-1 truncate">{s.name}</span>
              {s.id === currentShopId && <Check className="size-4 shrink-0" />}
            </DropdownMenuItem>
          ))}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAddDialogOpen(true)}>
                <Plus className="size-4" />
                ショップを追加
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/shops">ショップの管理...</Link>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {isAdmin && addDialog}
    </>
  );
}

// プロバイダのプロフィール画像があればそれを、なければ汎用アイコンを表示する。
// 画像の読み込みに失敗した場合(URL失効等)もアイコンにフォールバックする
function UserAvatar({ user }: { user: CurrentUser }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (user.avatar_url && !imgFailed) {
    return (
      <img
        src={user.avatar_url}
        alt=""
        className="size-5 shrink-0 rounded-full"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
      />
    );
  }
  return <UserRound className="size-4" />;
}

// ログイン中のアカウント表示とログアウトを担う。AUTH_ENABLED=falseのサーバーでは
// ログイン・ログアウトの概念がないため、非インタラクティブな表示のみにする
function UserMenu({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();

  async function handleLogout() {
    await logout();
    queryClient.clear();
    window.location.href = "/login";
  }

  if (!user.auth_enabled) {
    return (
      <Hint label="認証なし(ローカルモード)で稼働中">
        <span className={cn(topBarIconButtonClass, "cursor-default")}>
          <UserAvatar user={user} />
        </span>
      </Hint>
    );
  }

  return (
    <DropdownMenu>
      <Hint label={user.label ?? user.identifier}>
        <DropdownMenuTrigger className={topBarIconButtonClass}>
          <UserAvatar user={user} />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent>
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{user.label ?? user.identifier}</span>
            <Badge variant="secondary" className="shrink-0">
              {user.is_admin ? "管理者" : "一般"}
            </Badge>
          </div>
          {user.label && (
            <div className="truncate text-xs text-muted-foreground-subtle">{user.identifier}</div>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="size-4" />
          ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// デスクトップ判定をJSでも把握する(未満のときはサイドバーの折りたたみ
// 表示を無視して常にラベル込みのドロワーとして出すため)
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

// ショップが1件も無ければ(初回起動、または全削除で0件に戻った場合)、
// AppShell本体(サイドバー・ヘッダー付きの通常画面)を出さずに初回セットアップ
// ウィザードへ誘導する。未ログインの場合はShopContext側のfetchShopsが401になり
// (通常のページ同様)/loginへ先に飛ばされるので、ここに来る時点では
// ログイン済みか、そもそも認証不要のモードであることが前提になる
export function AppShellGate() {
  const { shops, isLoading } = useShopContext();
  if (isLoading) return null;
  if (shops.length === 0) return <Navigate to="/setup" replace />;
  return <AppShell />;
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const { currentShopId, currentShop } = useShopContext();
  // 現在選択中のショップのプラットフォームと合わないplatformOnly項目は出さない
  // (例: 手動ショップ選択中は「リストック予約」を、BASEショップ選択中は「商品管理(手動)」を隠す)
  const visibleNavGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.platformOnly || item.platformOnly === currentShop?.platform),
  })).filter((group) => group.items.length > 0);
  // 未ログイン(401)ならfetchCurrentUser内部の共通処理が/loginへ即リダイレクトする。
  // それが完了するまでダッシュボード等の中身を一切描画しない(ちらつき防止)
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["current-user"],
    queryFn: fetchCurrentUser,
    retry: false,
  });
  // サイドバーの通知バッジ用件数。ページ遷移(サイドメニュー押下含む)のたびに
  // 再取得するので、バックグラウンドの定期更新は「同じページに長時間いる間の
  // 保険」程度でよく、頻度を上げる必要は無い
  const { data: navCounts, refetch: refetchNavCounts } = useQuery({
    queryKey: ["nav-counts", currentShopId],
    queryFn: () => fetchNavCounts(currentShopId ?? undefined),
    enabled: !!currentUser,
    refetchInterval: 20 * 60 * 1000,
  });
  // タブレット未満では折りたたみ(アイコンのみ)表示を無視し、常にラベル込みで出す
  const effectiveCollapsed = isDesktop && collapsed;

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  // ページ遷移したらドロワーを閉じ、通知バッジの件数も最新化する
  useEffect(() => {
    setDrawerOpen(false);
    refetchNavCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Escapeキーでドロワーを閉じる
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  if (userLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">読み込み中...</div>;
  }
  if (!currentUser) {
    // 401だった場合、fetchCurrentUser内で既に/loginへの遷移が始まっている
    return null;
  }

  return (
    <div className="flex h-screen flex-col print:block print:h-auto">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 lg:px-6 print:hidden">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="メニューを開く"
            className={cn(topBarIconButtonClass, "lg:hidden")}
          >
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <LogoMark className="size-12 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-3xl font-bold tracking-tight">UniStock</div>
                <DemoModeBadge />
              </div>
              <div className="truncate text-[11px] text-muted-foreground">在庫・発注・注文の統合管理</div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ShopSwitcher isAdmin={currentUser.is_admin} />
          <ThemeToggleButton />
          <NotificationBell isAdmin={currentUser.is_admin} />
          <DocsLinkButton />
          <UserMenu user={currentUser} />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 print:block">
        {/* タブレット未満: ドロワー表示中の背景オーバーレイ */}
        {drawerOpen && (
          <div
            className="fixed inset-x-0 bottom-0 top-16 z-30 bg-black/40 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <aside
          className={cn(
            "group fixed bottom-0 left-0 top-16 z-40 flex w-64 -translate-x-full flex-col border-r border-border bg-card px-4 py-6 transition-transform duration-200 print:hidden",
            // lg以上はrelativeにして角の折りたたみボタンの基準にするが、position:relativeは
            // top/left/bottom等をオフセットとして解釈してしまう(staticと違い無視されない)ため、
            // 上のfixed用の値を明示的に打ち消しておく(打ち消し忘れるとヘッダー分ずれて表示される)
            "lg:relative lg:inset-auto lg:z-auto lg:translate-x-0 lg:transition-[width]",
            drawerOpen && "translate-x-0",
            collapsed ? "lg:w-16 lg:px-2" : "lg:w-64"
          )}
        >
          <SidebarCollapseToggle collapsed={effectiveCollapsed} onToggle={() => setCollapsed((v) => !v)} />
          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {visibleNavGroups.map((group, i) => (
              <div
                key={i}
                className={cn("flex flex-col gap-1", i > 0 && "mt-3 border-t border-muted-foreground/15 pt-3")}
              >
                {group.label && !effectiveCollapsed && (
                  <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => (
                  <NavItemLink
                    key={item.to}
                    {...item}
                    collapsed={effectiveCollapsed}
                    count={item.countKey ? navCounts?.[item.countKey] : undefined}
                  />
                ))}
              </div>
            ))}
          </nav>
          <div className="mt-3 flex shrink-0 flex-col gap-1 border-t border-muted-foreground/15 pt-3">
            <NavItemLink {...SETTINGS_ITEM} collapsed={effectiveCollapsed} />
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto overflow-x-auto px-6 py-8 lg:px-14 lg:py-12 print:block print:h-auto print:overflow-visible print:p-0">
          <div className="mx-auto max-w-6xl print:max-w-none">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
