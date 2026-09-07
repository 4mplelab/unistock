import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import OAuthProviderButtons from "@/components/OAuthProviderButtons";
import LogoMark from "@/components/LogoMark";
import { fetchHealth } from "@/api/client";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "ログインに失敗しました。もう一度お試しください",
  not_allowed: "このアカウントにはUniStockへのアクセス権がありません。管理者にお問い合わせください",
  profile_failed:
    "プロフィール情報を取得できませんでした(GitHubの場合はメールアドレスが検証済みか確認してください)",
};

// デモモードでは実際のOAuth連携を一切行わず、サーバー側が全リクエストを固定の
// デモアカウントとして扱う(require_auth参照)。Google/X等のクライアントID設定が
// 無くてもボタン1つで試せるようにするための専用UI
function DemoLoginButton() {
  const navigate = useNavigate();
  return (
    <div className="grid gap-3">
      <p className="text-center text-sm text-muted-foreground">
        デモモードで動作中です。ログイン処理は不要で、すぐに試せます
      </p>
      <Button size="lg" className="w-full" onClick={() => navigate("/")}>
        デモを試す
      </Button>
    </div>
  );
}

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get("error");
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? "エラーが発生しました") : null;
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: 60_000 });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <LogoMark className="mx-auto size-12" />
          <CardTitle className="text-2xl">UniStock</CardTitle>
          <CardDescription>在庫・発注・注文の統合管理</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {errorMessage && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage}</p>
          )}
          {health?.demo_mode ? <DemoLoginButton /> : <OAuthProviderButtons />}
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
