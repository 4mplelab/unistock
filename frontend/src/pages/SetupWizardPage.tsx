import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { fetchCurrentUser, fetchHealth } from "@/api/client";
import { useShopContext } from "@/contexts/ShopContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import OAuthProviderButtons from "@/components/OAuthProviderButtons";
import ShopSetupFlow from "@/components/ShopSetupFlow";
import LogoMark from "@/components/LogoMark";

// ヘッダー/サイドバー無しの初回セットアップウィザード。ショップが0件のときだけ
// AppShellGate(components/AppShell.tsx)からここへ誘導される。
// - 未ログインなら先にログインしてもらう(最初にログインしたアカウントが
//   自動的に管理者になる。backend/app/routers/auth.pyのcallback参照)。
//   ログインは外部リダイレクトなので、成功すればコールバック経由で"/"に
//   戻り、ショップがまだ無いのでAppShellGateがまたこのページへ戻してくれる
// - ログイン済み(デモモード/認証無効ならそもそも未ログイン状態にならない)
//   ならショップ作成ステップへ進む
export default function SetupWizardPage() {
  const navigate = useNavigate();
  const { shops, isLoading: shopsLoading } = useShopContext();
  // ShopSetupFlowでショップを作成した直後、shops.length>0になった瞬間に
  // 下のガードが反応してステップ2(連携/URL設定)の画面ごと追い出されるのを防ぐ
  const [shopJustCreated, setShopJustCreated] = useState(false);
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: 60_000 });
  const demoMode = health?.demo_mode ?? false;

  const {
    isLoading: userLoading,
    isError: notLoggedIn,
  } = useQuery({ queryKey: ["current-user"], queryFn: fetchCurrentUser, retry: false });

  // 既にショップがあるなら、このウィザードはもう用済み(ただし今まさにこの
  // ウィザードの中で1件目を作った直後は除く。作成後のステップ2を出し続ける)
  if (!shopsLoading && shops.length > 0 && !shopJustCreated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 px-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <LogoMark className="mx-auto size-12" />
          <CardTitle className="text-2xl">UniStockへようこそ</CardTitle>
          <CardDescription>
            {userLoading
              ? "確認中..."
              : notLoggedIn
                ? "はじめに、ログインしてください。最初にログインしたアカウントが管理者になります"
                : "はじめに、ショップを1つ登録しましょう"}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-12">
          {userLoading ? null : notLoggedIn ? (
            <OAuthProviderButtons />
          ) : (
            <ShopSetupFlow
              demoMode={demoMode}
              showConnectStep
              onCreated={() => setShopJustCreated(true)}
              onDone={() => navigate("/")}
            />
          )}
        </CardContent>
      </Card>
      <a
        href="/docs/"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="size-4" />
        使い方ドキュメント
      </a>
    </div>
  );
}
