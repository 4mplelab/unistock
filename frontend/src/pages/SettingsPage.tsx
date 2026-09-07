import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import {
  fetchCurrentUser,
  fetchHealth,
  fetchResetPhrases,
  fetchSettings,
  resetAllData,
  resetOrderHistory,
  runRetentionCleanupNow,
  testNotificationEmail,
  testNotificationWebhook,
  updateSetting,
  type RetentionCleanupResult,
} from "../api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PartColorSettings from "@/components/PartColorSettings";
import AllowedUserSettings from "@/components/AllowedUserSettings";
import ApiKeySettings from "@/components/ApiKeySettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toDatetimeLocalInput } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { useShopContext } from "@/contexts/ShopContext";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import SaveFlashCheck from "@/components/SaveFlashCheck";
import FieldError from "@/components/FieldError";
import Hint from "@/components/Hint";

const ENABLED_KEY = "order_poller.enabled";
const INTERVAL_KEY = "order_poller.interval_seconds";
const GO_LIVE_KEY = "order_poller.go_live_at";

const EMAIL_ENABLED_KEY = "notification.email.enabled";
const EMAIL_TO_KEY = "notification.email.to";

const WEBHOOK_PLATFORMS: { value: string; label: string; placeholder: string }[] = [
  { value: "slack", label: "Slack", placeholder: "https://hooks.slack.com/services/..." },
  { value: "discord", label: "Discord", placeholder: "https://discord.com/api/webhooks/..." },
  { value: "mattermost", label: "Mattermost", placeholder: "https://.../hooks/..." },
  { value: "google_chat", label: "Google Chat", placeholder: "https://chat.googleapis.com/v1/spaces/..." },
  { value: "teams", label: "Microsoft Teams(Workflows)", placeholder: "https://.../workflows/..." },
];

function webhookUrlKey(platform: string, shopId?: number): string {
  const base = `notification.webhook.${platform}.url`;
  return shopId != null ? `${base}.${shopId}` : base;
}

function emailToKey(shopId?: number): string {
  return shopId != null ? `${EMAIL_TO_KEY}.${shopId}` : EMAIL_TO_KEY;
}

const NOTIFICATION_CATEGORIES: { key: string; label: string }[] = [
  { key: "reorder_threshold", label: "部品が発注点を下回った" },
  { key: "po_overdue", label: "発注の予定納期を過ぎても未入荷" },
  { key: "buildable_threshold", label: "商品の作成可能数が閾値を下回った" },
  { key: "auth_error", label: "外部連携の認証エラー" },
  { key: "stock_operation_failed", label: "在庫操作の失敗" },
];

function notificationEnabledKey(category: string, channel: "webhook" | "email", shopId?: number): string {
  const base = `notification.enabled.${category}.${channel}`;
  return shopId != null ? `${base}.${shopId}` : base;
}

const selectClass =
  "h-8 rounded-lg border border-input bg-card px-2 py-0.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type ResetDialogKind = "all" | "order-history" | null;

// 注文履歴(retention.orders_days)は一時的に対象外にしている。orders/order_items等は
// 売上・原価を計算できる唯一の元データであり、行ごと削除すると再現不可能になるため、
// 個人情報だけを匿名化する方式に置き換えるまで自動削除の選択肢自体を出さない
const RETENTION_FIELDS: { key: string; label: string }[] = [
  { key: "retention.purchase_orders_days", label: "発注履歴(入荷済み/キャンセル済みのみ)" },
  { key: "retention.stock_schedules_days", label: "リストック予約履歴(実行済み/キャンセル済みのみ)" },
  { key: "retention.stock_movements_days", label: "部品・中間品の在庫変動履歴" },
  { key: "retention.event_logs_days", label: "イベントログ" },
];

function retentionResultSummary(result: RetentionCleanupResult): string {
  const total = result.purchase_orders + result.stock_schedules + result.stock_movements + result.event_logs;
  if (total === 0) return "削除対象のデータはありませんでした";
  return `発注${result.purchase_orders}件・スケジュール${result.stock_schedules}件・在庫変動履歴${result.stock_movements}件・イベントログ${result.event_logs}件を削除しました`;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: fetchCurrentUser, retry: false });

  const { data: resetPhrases } = useQuery({ queryKey: ["reset-phrases"], queryFn: fetchResetPhrases });
  const [resetDialog, setResetDialog] = useState<ResetDialogKind>(null);
  const [confirmInput, setConfirmInput] = useState("");

  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: 60_000 });
  const demoMode = health?.demo_mode ?? false;

  const resetAllMutation = useMutation({
    mutationFn: (phrase: string) => resetAllData(phrase),
    onSuccess: () => {
      setResetDialog(null);
      setConfirmInput("");
      queryClient.invalidateQueries();
    },
  });

  const resetOrderHistoryMutation = useMutation({
    mutationFn: (phrase: string) => resetOrderHistory(phrase),
    onSuccess: () => {
      setResetDialog(null);
      setConfirmInput("");
      queryClient.invalidateQueries();
    },
  });

  function openResetDialog(kind: ResetDialogKind) {
    setResetDialog(kind);
    setConfirmInput("");
    resetAllMutation.reset();
    resetOrderHistoryMutation.reset();
  }

  function handleConfirmReset() {
    if (resetDialog === "all") resetAllMutation.mutate(confirmInput);
    else if (resetDialog === "order-history") resetOrderHistoryMutation.mutate(confirmInput);
  }

  const requiredPhrase =
    resetDialog === "all"
      ? resetPhrases?.reset_all
      : resetDialog === "order-history"
        ? resetPhrases?.reset_order_history
        : undefined;
  const activeMutation = resetDialog === "all" ? resetAllMutation : resetOrderHistoryMutation;

  const mutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateSetting(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  const feedback = useSaveFeedback();

  const settingsMap = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
  const enabled = settingsMap[ENABLED_KEY] === "true";
  const savedInterval = settingsMap[INTERVAL_KEY] ?? "60";
  const savedGoLive = settingsMap[GO_LIVE_KEY] ?? "";

  const [interval, setInterval] = useState(savedInterval);
  // 空欄のままなら「初回同期時点を使う」という意味を持つ項目なので、現在日時のデフォルト値は入れない
  const [goLive, setGoLive] = useState(savedGoLive ? toDatetimeLocalInput(savedGoLive) : "");

  useEffect(() => setInterval(savedInterval), [savedInterval]);
  useEffect(() => setGoLive(savedGoLive ? toDatetimeLocalInput(savedGoLive) : ""), [savedGoLive]);

  const savedRetentionDays = Object.fromEntries(RETENTION_FIELDS.map((f) => [f.key, settingsMap[f.key] ?? ""]));
  const [retentionDays, setRetentionDays] = useState<Record<string, string>>(savedRetentionDays);
  useEffect(() => setRetentionDays(savedRetentionDays), [JSON.stringify(savedRetentionDays)]);

  // 通知設定の編集対象。「共通」も選択肢の1つとして同じフォームで編集する(以前は共通と
  // ショップ別で別々のフォームを並べていたが分かりにくいとの指摘で統合)。ヘッダーの
  // ショップ切り替え(他の画面にも影響する)とは独立させ、このカード内だけのローカルな選択にする
  const { shops } = useShopContext();
  const [editTarget, setEditTarget] = useState<"common" | number>("common");
  const editShopId = editTarget === "common" ? undefined : editTarget;

  const emailEnabled = settingsMap[EMAIL_ENABLED_KEY] === "true";

  // ショップを選んでいるときは「このショップ専用の上書き」のみを表示・保存する(共通設定の
  // 値をここに表示すると、未変更のまま他フィールドのblurで上書き保存されてしまう事故に
  // つながるため)。空欄/「継承」に戻せば共通設定にフォールバックする(バックエンド側の
  // get_value_with_shop_fallback)
  const savedWebhookUrls = Object.fromEntries(
    WEBHOOK_PLATFORMS.map((p) => [p.value, settingsMap[webhookUrlKey(p.value, editShopId)] ?? ""])
  );
  const [webhookUrls, setWebhookUrls] = useState<Record<string, string>>(savedWebhookUrls);
  useEffect(() => setWebhookUrls(savedWebhookUrls), [JSON.stringify(savedWebhookUrls), editTarget]);
  const savedEmailTo = settingsMap[emailToKey(editShopId)] ?? "";
  const [emailTo, setEmailTo] = useState(savedEmailTo);
  useEffect(() => setEmailTo(savedEmailTo), [savedEmailTo, editTarget]);

  // 通知のテスト送信。保存前に今入力中の値でその場でテストできるよう、settingsMapではなく
  // 画面上のwebhookUrls/emailToの値をそのまま送る。複数ボタンが同時に押されても混ざらないよう、
  // 送信中は対象キー(プラットフォーム名 or "email")ごとに管理する
  const [testingKey, setTestingKey] = useState<string | null>(null);

  // テスト送信はHTTP自体は常に200で返り、成否はレスポンス本文(success)で表れるため
  // (Promiseのreject/resolveでは判定できない)、feedback.succeed/failを手動で呼ぶ。
  // ボタンのフラッシュ状態は"test:"接頭辞のkeyにして、隣のフィールド保存のkeyと衝突しないようにする
  function testFlashKey(resultKey: string) {
    return `test:${resultKey}`;
  }

  const testWebhookMutation = useMutation({
    mutationFn: ({ platform, url }: { platform: string; url: string }) => testNotificationWebhook(platform, url),
  });
  async function handleTestWebhook(platform: string, url: string, resultKey: string) {
    setTestingKey(resultKey);
    try {
      const result = await testWebhookMutation.mutateAsync({ platform, url });
      if (result.success) feedback.succeed(testFlashKey(resultKey));
      else feedback.fail(testFlashKey(resultKey), result.message);
    } finally {
      setTestingKey(null);
    }
  }

  const testEmailMutation = useMutation({
    mutationFn: (to: string) => testNotificationEmail(to),
  });
  async function handleTestEmail(to: string, resultKey: string) {
    setTestingKey(resultKey);
    try {
      const result = await testEmailMutation.mutateAsync(to);
      if (result.success) feedback.succeed(testFlashKey(resultKey));
      else feedback.fail(testFlashKey(resultKey), result.message);
    } finally {
      setTestingKey(null);
    }
  }

  const cleanupMutation = useMutation({
    mutationFn: runRetentionCleanupNow,
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground-subtle">システム全体の設定</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>注文データ取得</CardTitle>
            <CardDescription>連携ショップから注文を自動取得する間隔を設定します</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
            {error && <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>}

            {!isLoading && !error && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="enabled">自動取得</Label>
                    <p className="text-xs text-muted-foreground-subtle">オンにすると一定間隔で注文を自動取得します</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SaveFlashCheck show={feedback.isFlashing(ENABLED_KEY)} />
                    <Switch
                      id="enabled"
                      checked={enabled}
                      onCheckedChange={(checked) =>
                        mutation.mutate(
                          { key: ENABLED_KEY, value: checked ? "true" : "false" },
                          feedback.callbacks(ENABLED_KEY)
                        )
                      }
                    />
                  </div>
                </div>
                <FieldError message={feedback.errorFor(ENABLED_KEY)} />

                <div className="grid gap-1.5">
                  <Label htmlFor="interval">実行間隔（秒）</Label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      id="interval"
                      value={interval}
                      onChange={setInterval}
                      onBlur={() =>
                        mutation.mutate({ key: INTERVAL_KEY, value: interval }, feedback.callbacks(INTERVAL_KEY))
                      }
                      className="w-32 text-right"
                    />
                    <SaveFlashCheck show={feedback.isFlashing(INTERVAL_KEY)} />
                  </div>
                  <FieldError message={feedback.errorFor(INTERVAL_KEY)} />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="go_live">運用開始日時</Label>
                  <p className="text-xs text-muted-foreground-subtle">
                    この日時以降の注文を対象にします。未設定の場合は初回同期時点が使われます
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      id="go_live"
                      type="datetime-local"
                      value={goLive}
                      onChange={(e) => setGoLive(e.target.value)}
                      onBlur={() =>
                        goLive &&
                        mutation.mutate(
                          { key: GO_LIVE_KEY, value: new Date(goLive).toISOString() },
                          feedback.callbacks(GO_LIVE_KEY)
                        )
                      }
                      className="w-56"
                    />
                    <SaveFlashCheck show={feedback.isFlashing(GO_LIVE_KEY)} />
                  </div>
                  <FieldError message={feedback.errorFor(GO_LIVE_KEY)} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">データ管理</CardTitle>
            <CardDescription>
              以下の操作は取り消せません。実行前によく確認してください
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {demoMode && (
              <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                デモモードのため、データ消去はできません(デモ用のサンプルデータを保護するためです)
              </p>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">注文履歴のみ消去</div>
                <p className="text-xs text-muted-foreground-subtle">
                  一時的に無効化しています。注文データは売上・原価を計算できる唯一の記録のため、
                  行ごと削除すると再現できなくなります。氏名・住所・メールアドレスだけを消す方式に
                  置き換えるまでの措置です
                </p>
              </div>
              <Button variant="outline" disabled>
                消去する
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <div>
                <div className="text-sm font-medium">全データを消去</div>
                <p className="text-xs text-muted-foreground-subtle">
                  部品・中間品・BOM・注文・発注など業務データを全て削除します。サンプルデータ投入後や
                  設定のやり直し等で、本番運用を始める前にリセットしたい場合に使うことを想定しています
                  (ショップ連携の認証情報・この設定は消えません)
                </p>
              </div>
              <Button variant="destructive" onClick={() => openResetDialog("all")} disabled={demoMode}>
                全て消去する
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>自動データ削除</CardTitle>
            <CardDescription>
              完了済みの履歴データを、指定した日数を過ぎたら自動的に削除します(24時間おきに実行)。
              未対応の注文・未入荷の発注など進行中のデータは対象外です。空欄の項目は削除しません
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {RETENTION_FIELDS.map(({ key, label }) => (
                <div key={key} className="grid gap-1.5">
                  <Label htmlFor={key}>{label}</Label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      id={key}
                      placeholder="無期限"
                      value={retentionDays[key] ?? ""}
                      onChange={(v) => setRetentionDays((prev) => ({ ...prev, [key]: v }))}
                      onBlur={() =>
                        mutation.mutate({ key, value: retentionDays[key] ?? "" }, feedback.callbacks(key))
                      }
                      className="w-24 text-right"
                    />
                    <span className="shrink-0 text-sm text-muted-foreground-subtle">日</span>
                    <SaveFlashCheck show={feedback.isFlashing(key)} />
                  </div>
                  <FieldError message={feedback.errorFor(key)} />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <p className="text-xs text-muted-foreground-subtle">
                {demoMode
                  ? "デモモードのため実行できません(デモ用のサンプルデータを保護するためです)"
                  : "設定変更を今すぐ反映したい場合や、動作確認のために手動実行できます"}
              </p>
              <Button
                variant="outline"
                onClick={() => cleanupMutation.mutate()}
                disabled={demoMode || cleanupMutation.isPending}
              >
                {cleanupMutation.isPending ? "整理中..." : "今すぐ整理する"}
              </Button>
            </div>
            {cleanupMutation.data && (
              <p className="text-xs text-muted-foreground-subtle">{retentionResultSummary(cleanupMutation.data)}</p>
            )}
            {cleanupMutation.error && (
              <p className="text-xs text-destructive">{(cleanupMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>通知</CardTitle>
            <CardDescription>
              発注点割れ等の業務イベントをWebhook・メールで通知します。カテゴリごとにチャネルを個別に選べます
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-1.5">
              <Label htmlFor="notification_target">設定対象</Label>
              <p className="text-xs text-muted-foreground-subtle">
                「共通」は全ショップの既定値です。ショップを選ぶとそのショップだけの上書きを設定できます
                (未入力/「継承」の項目は共通設定にフォールバックします)。ここでの選択はヘッダーのショップ切り替えとは独立しています
              </p>
              <select
                id="notification_target"
                className={cn(selectClass, "w-48")}
                value={editTarget}
                onChange={(e) => setEditTarget(e.target.value === "common" ? "common" : Number(e.target.value))}
              >
                <option value="common">共通</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4">
              <p className="text-sm font-medium">Webhook URL</p>
              <p className="text-xs text-muted-foreground-subtle">
                入力したプラットフォームすべてに同時に送信します(複数登録可)
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {WEBHOOK_PLATFORMS.map((p) => {
                  const fieldKey = webhookUrlKey(p.value, editShopId);
                  return (
                    <div key={p.value} className="grid gap-1.5">
                      <Label htmlFor={`webhook_${p.value}`}>{p.label}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`webhook_${p.value}`}
                          placeholder={editTarget === "common" ? p.placeholder : "(未設定 → 共通設定を使用)"}
                          value={webhookUrls[p.value] ?? ""}
                          onChange={(e) => setWebhookUrls((prev) => ({ ...prev, [p.value]: e.target.value }))}
                          onBlur={() =>
                            mutation.mutate(
                              { key: fieldKey, value: webhookUrls[p.value] ?? "" },
                              feedback.callbacks(fieldKey)
                            )
                          }
                        />
                        <SaveFlashCheck show={feedback.isFlashing(fieldKey)} />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          disabled={!webhookUrls[p.value] || testingKey === p.value}
                          onClick={() => handleTestWebhook(p.value, webhookUrls[p.value] ?? "", p.value)}
                        >
                          {feedback.isFlashing(testFlashKey(p.value)) ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="size-4" />
                              送信完了
                            </span>
                          ) : testingKey === p.value ? (
                            "送信中..."
                          ) : (
                            "テスト送信"
                          )}
                        </Button>
                      </div>
                      <FieldError message={feedback.errorFor(fieldKey)} />
                      <FieldError message={feedback.errorFor(testFlashKey(p.value))} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="email_enabled">メール通知</Label>
                    <p className="text-xs text-muted-foreground-subtle">サーバーのSMTP設定(.env)が必要です</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SaveFlashCheck show={feedback.isFlashing(EMAIL_ENABLED_KEY)} />
                    <Switch
                      id="email_enabled"
                      checked={emailEnabled}
                      onCheckedChange={(checked) =>
                        mutation.mutate(
                          { key: EMAIL_ENABLED_KEY, value: checked ? "true" : "false" },
                          feedback.callbacks(EMAIL_ENABLED_KEY)
                        )
                      }
                    />
                  </div>
                </div>
                <FieldError message={feedback.errorFor(EMAIL_ENABLED_KEY)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email_to">送信先メールアドレス</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="email_to"
                    type="email"
                    placeholder={editTarget === "common" ? "you@example.com" : "(未設定 → 共通設定を使用)"}
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    onBlur={() =>
                      mutation.mutate(
                        { key: emailToKey(editShopId), value: emailTo },
                        feedback.callbacks(emailToKey(editShopId))
                      )
                    }
                  />
                  <SaveFlashCheck show={feedback.isFlashing(emailToKey(editShopId))} />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!emailTo || testingKey === "email"}
                    onClick={() => handleTestEmail(emailTo, "email")}
                  >
                    {feedback.isFlashing(testFlashKey("email")) ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-4" />
                        送信完了
                      </span>
                    ) : testingKey === "email" ? (
                      "送信中..."
                    ) : (
                      "テスト送信"
                    )}
                  </Button>
                </div>
                <FieldError message={feedback.errorFor(emailToKey(editShopId))} />
                <FieldError message={feedback.errorFor(testFlashKey("email"))} />
              </div>
            </div>

            <div className="grid gap-2 border-t pt-4">
              <p className="text-sm font-medium">通知対象</p>
              {editTarget !== "common" && (
                <p className="text-xs text-muted-foreground-subtle">
                  「継承」の項目は共通設定に従います。発注点割れはどのショップにも属さないイベントですが、
                  ここで有効にすればこのショップにも配信されます(共通設定と送信先が重複する場合は1通にまとめられます)
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground-subtle">
                      <th className="py-1 font-normal">カテゴリ</th>
                      <th className="w-24 py-1 text-center font-normal">Webhook</th>
                      <th className="w-24 py-1 text-center font-normal">メール</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NOTIFICATION_CATEGORIES.map(({ key, label }) => (
                      <tr key={key} className="border-t">
                        <td className="py-2 pr-2">{label}</td>
                        {(["webhook", "email"] as const).map((channel) => {
                          const settingKey = notificationEnabledKey(key, channel, editShopId);
                          const cellError = feedback.errorFor(settingKey);
                          return (
                            <td key={channel} className="py-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {editTarget === "common" ? (
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    checked={settingsMap[settingKey] === "true"}
                                    onChange={(e) =>
                                      mutation.mutate(
                                        { key: settingKey, value: e.target.checked ? "true" : "false" },
                                        feedback.callbacks(settingKey)
                                      )
                                    }
                                  />
                                ) : (
                                  <select
                                    className={selectClass}
                                    value={settingsMap[settingKey] ?? ""}
                                    onChange={(e) =>
                                      mutation.mutate({ key: settingKey, value: e.target.value }, feedback.callbacks(settingKey))
                                    }
                                  >
                                    <option value="">継承</option>
                                    <option value="true">ON</option>
                                    <option value="false">OFF</option>
                                  </select>
                                )}
                                {cellError && (
                                  <Hint label={cellError}>
                                    <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                                  </Hint>
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
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>部品のカラーパレット</CardTitle>
            <CardDescription>部品の「カラー」で選べる基本色を管理します</CardDescription>
          </CardHeader>
          <CardContent>
            <PartColorSettings />
          </CardContent>
        </Card>

        {currentUser?.is_admin && currentUser.auth_enabled && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>許可ユーザー</CardTitle>
              <CardDescription>UniStockへのログインを許可するアカウントを管理します</CardDescription>
            </CardHeader>
            <CardContent>
              <AllowedUserSettings />
            </CardContent>
          </Card>
        )}

        {currentUser?.is_admin && currentUser.auth_enabled && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>APIキー</CardTitle>
              <CardDescription>外部プロジェクトからAPIを直接呼び出すためのキーを管理します</CardDescription>
            </CardHeader>
            <CardContent>
              <ApiKeySettings />
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={resetDialog !== null} onOpenChange={(open) => !open && setResetDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resetDialog === "all" ? "全データを消去しますか？" : "注文履歴を消去しますか？"}
            </DialogTitle>
            <DialogDescription>
              この操作は取り消せません。続行するには下の欄に「{requiredPhrase ?? "..."}」と正確に入力してください。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={requiredPhrase}
            autoFocus
          />
          {activeMutation.error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(activeMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialog(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={!requiredPhrase || confirmInput !== requiredPhrase || activeMutation.isPending}
              onClick={handleConfirmReset}
            >
              {activeMutation.isPending ? "削除中..." : "削除を実行"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
