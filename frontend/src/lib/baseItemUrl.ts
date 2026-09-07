import { useQuery } from "@tanstack/react-query";
import { fetchSettings } from "@/api/client";

// 設定画面の入力欄に薄く表示する例(プレースホルダー)。実際のリンク生成ではフォールバック
// として使わない(未設定なら本当にリンクを出さない)
export const DEFAULT_BASE_ITEM_ADMIN_URL_TEMPLATE = "https://admin.thebase.com/shop_admin/items/edit/{item_id}";
export const DEFAULT_BASE_ITEM_SHOP_URL_TEMPLATE = "https://your-shop.thebase.in/items/{item_id}";

export function itemAdminUrlKey(shopId: number): string {
  return `shop.${shopId}.item_admin_url_template`;
}

export function itemShopUrlKey(shopId: number): string {
  return `shop.${shopId}.item_shop_url_template`;
}

function useBaseItemUrl(settingKey: string, itemId: string): string | null {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const template = data?.find((s) => s.key === settingKey)?.value;
  if (!template) return null;
  return template.replace("{item_id}", encodeURIComponent(itemId));
}

// ショップの管理画面で該当商品の編集ページを開くためのURL。テンプレートは設定ページで
// ショップごとに登録する(プラットフォーム問わず)。未設定ならnull
export function useBaseItemAdminUrl(shopId: number, itemId: string): string | null {
  return useBaseItemUrl(itemAdminUrlKey(shopId), itemId);
}

// ショップの公開商品ページ(お客様が見るページ)を開くためのURL。テンプレートは設定ページで
// ショップごとに登録する(プラットフォーム問わず)。未設定ならnull
export function useBaseItemShopUrl(shopId: number, itemId: string): string | null {
  return useBaseItemUrl(itemShopUrlKey(shopId), itemId);
}
