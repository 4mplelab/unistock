import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSettings, updateSetting } from "@/api/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { orderAdminUrlKey, DEFAULT_BASE_ORDER_ADMIN_URL_TEMPLATE } from "@/lib/baseOrderUrl";
import {
  itemAdminUrlKey,
  itemShopUrlKey,
  DEFAULT_BASE_ITEM_ADMIN_URL_TEMPLATE,
  DEFAULT_BASE_ITEM_SHOP_URL_TEMPLATE,
} from "@/lib/baseItemUrl";
import SaveFlashCheck from "@/components/SaveFlashCheck";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";

// デモモードでURLテンプレート欄に表示する例。自社の実際のURL(保存済みの設定値)を
// 第三者に見せないため、実際の値の代わりにこの例を表示する(編集も不可にする)。
// BASEショップにはBASEの実際のURL形をそのまま例として出せるが、手動管理等それ以外の
// プラットフォームでは特定サイトを想定できないため汎用的な例にする
const DEMO_ORDER_ADMIN_URL_EXAMPLE = "https://admin.thebase.com/shop_admin/orders/order/{unique_key}";
const DEMO_ITEM_SHOP_URL_EXAMPLE = "https://your-shop.thebase.in/items/{item_id}";
const DEMO_ITEM_ADMIN_URL_EXAMPLE = "https://admin.thebase.com/shop_admin/items/edit/{item_id}";
const GENERIC_ORDER_ADMIN_URL_EXAMPLE = "https://example.com/admin/orders/{unique_key}";
const GENERIC_ITEM_SHOP_URL_EXAMPLE = "https://example.com/items/{item_id}";
const GENERIC_ITEM_ADMIN_URL_EXAMPLE = "https://example.com/admin/items/{item_id}";

/** ショップ管理画面/公開商品ページのURLテンプレート設定3種(注文管理・商品ページ・
 * 商品編集ページ)。ショップ設定ページの既存カードと、初回セットアップウィザードの
 * どちらからも同じ入力欄を使う。プラットフォーム問わず任意設定で、空欄のままなら
 * 該当するリンク自体を表示しない(既定URLへのフォールバックは行わない)。
 * プレースホルダー・デモ例はBASEショップだけ実際のBASEのURL形を示し、それ以外の
 * プラットフォームでは汎用的な例(example.com)にする(特定の外部サイトを想定できないため)。 */
export default function ShopUrlTemplates({
  shopId,
  demoMode,
  platform,
}: {
  shopId: number;
  demoMode: boolean;
  platform: string;
}) {
  const isBase = platform === "base";
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  const settingMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateSetting(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  const feedback = useSaveFeedback();

  const savedOrderAdminUrl = settingsMap[orderAdminUrlKey(shopId)] ?? "";
  const [orderAdminUrl, setOrderAdminUrl] = useState(savedOrderAdminUrl);
  useEffect(() => setOrderAdminUrl(savedOrderAdminUrl), [savedOrderAdminUrl]);

  const savedItemShopUrl = settingsMap[itemShopUrlKey(shopId)] ?? "";
  const [itemShopUrl, setItemShopUrl] = useState(savedItemShopUrl);
  useEffect(() => setItemShopUrl(savedItemShopUrl), [savedItemShopUrl]);

  const savedItemAdminUrl = settingsMap[itemAdminUrlKey(shopId)] ?? "";
  const [itemAdminUrl, setItemAdminUrl] = useState(savedItemAdminUrl);
  useEffect(() => setItemAdminUrl(savedItemAdminUrl), [savedItemAdminUrl]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`order_admin_url-${shopId}`}>注文の管理画面URL</Label>
        <p className="text-xs text-muted-foreground-subtle">
          注文一覧・ピッキングの注文IDから開く管理画面のリンク先。{"{unique_key}"}
          の部分が実際の注文IDに置き換わります。空欄の場合はリンクを表示しません
          {demoMode && "(デモでは例を表示しています。編集はできません)"}
        </p>
        <div className="flex items-center gap-2">
          <Input
            id={`order_admin_url-${shopId}`}
            autoComplete="off"
            value={demoMode ? (isBase ? DEMO_ORDER_ADMIN_URL_EXAMPLE : GENERIC_ORDER_ADMIN_URL_EXAMPLE) : orderAdminUrl}
            placeholder={
              demoMode ? undefined : isBase ? DEFAULT_BASE_ORDER_ADMIN_URL_TEMPLATE : GENERIC_ORDER_ADMIN_URL_EXAMPLE
            }
            readOnly={demoMode}
            onChange={(e) => !demoMode && setOrderAdminUrl(e.target.value)}
            onBlur={() =>
              !demoMode &&
              settingMutation.mutate(
                { key: orderAdminUrlKey(shopId), value: orderAdminUrl },
                feedback.callbacks("order_admin_url")
              )
            }
            className="font-mono text-xs"
          />
          <SaveFlashCheck show={feedback.isFlashing("order_admin_url")} />
        </div>
        <FieldError message={feedback.errorFor("order_admin_url")} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`item_shop_url-${shopId}`}>商品ページURL</Label>
        <p className="text-xs text-muted-foreground-subtle">
          BOM一覧の商品名から開く、お客様向けの商品ページのリンク先。{"{item_id}"}
          の部分が実際の商品IDに置き換わります。空欄の場合はリンクを表示しません
          {demoMode && "(デモでは例を表示しています。編集はできません)"}
        </p>
        <div className="flex items-center gap-2">
          <Input
            id={`item_shop_url-${shopId}`}
            autoComplete="off"
            value={demoMode ? (isBase ? DEMO_ITEM_SHOP_URL_EXAMPLE : GENERIC_ITEM_SHOP_URL_EXAMPLE) : itemShopUrl}
            placeholder={
              demoMode ? undefined : isBase ? DEFAULT_BASE_ITEM_SHOP_URL_TEMPLATE : GENERIC_ITEM_SHOP_URL_EXAMPLE
            }
            readOnly={demoMode}
            onChange={(e) => !demoMode && setItemShopUrl(e.target.value)}
            onBlur={() =>
              !demoMode &&
              settingMutation.mutate(
                { key: itemShopUrlKey(shopId), value: itemShopUrl },
                feedback.callbacks("item_shop_url")
              )
            }
            className="font-mono text-xs"
          />
          <SaveFlashCheck show={feedback.isFlashing("item_shop_url")} />
        </div>
        <FieldError message={feedback.errorFor("item_shop_url")} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`item_admin_url-${shopId}`}>商品編集ページURL</Label>
        <p className="text-xs text-muted-foreground-subtle">
          BOM一覧の商品IDから開く管理画面の編集ページのリンク先。{"{item_id}"}
          の部分が実際の商品IDに置き換わります。空欄の場合はリンクを表示しません
          {demoMode && "(デモでは例を表示しています。編集はできません)"}
        </p>
        <div className="flex items-center gap-2">
          <Input
            id={`item_admin_url-${shopId}`}
            autoComplete="off"
            value={demoMode ? (isBase ? DEMO_ITEM_ADMIN_URL_EXAMPLE : GENERIC_ITEM_ADMIN_URL_EXAMPLE) : itemAdminUrl}
            placeholder={
              demoMode ? undefined : isBase ? DEFAULT_BASE_ITEM_ADMIN_URL_TEMPLATE : GENERIC_ITEM_ADMIN_URL_EXAMPLE
            }
            readOnly={demoMode}
            onChange={(e) => !demoMode && setItemAdminUrl(e.target.value)}
            onBlur={() =>
              !demoMode &&
              settingMutation.mutate(
                { key: itemAdminUrlKey(shopId), value: itemAdminUrl },
                feedback.callbacks("item_admin_url")
              )
            }
            className="font-mono text-xs"
          />
          <SaveFlashCheck show={feedback.isFlashing("item_admin_url")} />
        </div>
        <FieldError message={feedback.errorFor("item_admin_url")} />
      </div>
    </div>
  );
}
