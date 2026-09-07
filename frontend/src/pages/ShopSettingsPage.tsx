import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentUser, fetchHealth } from "@/api/client";
import { useShopContext } from "@/contexts/ShopContext";
import ShopConnectionCard from "@/components/ShopConnectionCard";

// サイドバーには出さず、ヘッダーのショップ切り替えメニュー(「ショップの管理...」)
// からのみ遷移する管理者向けページ。設定ページ(全ユーザー向けの一般設定)とは
// 分けている
export default function ShopSettingsPage() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["current-user"],
    queryFn: fetchCurrentUser,
    retry: false,
  });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: 60_000 });
  const demoMode = health?.demo_mode ?? false;
  const { shops } = useShopContext();

  if (!userLoading && !currentUser?.is_admin) {
    return <Navigate to="/" replace />;
  }

  const activeCount = shops.filter((s) => s.is_active).length;

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">ショップ設定</h1>
        <p className="mt-1 text-sm text-muted-foreground-subtle">
          接続するショップを管理します。同じプラットフォームを複数ショップ、異なるプラットフォームの
          組み合わせのどちらにも対応しています
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {shops.map((shop) => (
          <ShopConnectionCard
            key={shop.id}
            shop={shop}
            demoMode={demoMode}
            canDelete
            isOnlyActiveShop={activeCount <= 1}
          />
        ))}
      </div>
    </div>
  );
}
