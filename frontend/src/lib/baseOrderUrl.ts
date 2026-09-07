import { useQuery } from "@tanstack/react-query";
import { fetchSettings } from "@/api/client";

// 設定画面の入力欄に薄く表示する例(プレースホルダー)。実際のリンク生成では
// フォールバックとして使わない(未設定なら本当にリンクを出さない)
export const DEFAULT_BASE_ORDER_ADMIN_URL_TEMPLATE =
  "https://admin.thebase.com/shop_admin/orders/order/{unique_key}";

export function orderAdminUrlKey(shopId: number): string {
  return `shop.${shopId}.order_admin_url_template`;
}

// ショップの管理画面で該当注文を開くためのURL。テンプレートは設定ページでショップごとに
// 登録する(プラットフォーム問わず)。未設定ならnull(呼び出し側はリンク自体を出さない)
export function useBaseOrderAdminUrl(shopId: number, uniqueKey: string): string | null {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const template = data?.find((s) => s.key === orderAdminUrlKey(shopId))?.value;
  if (!template) return null;
  return template.replace("{unique_key}", encodeURIComponent(uniqueKey));
}
