import { useQuery } from "@tanstack/react-query";
import { fetchConfiguredProviders, providerLoginUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { GithubIcon, GoogleIcon, MicrosoftIcon, XIcon } from "@/components/ProviderIcons";
import type { OAuthProvider } from "@/types/auth";

const PROVIDERS: { id: OAuthProvider; label: string; icon: typeof GoogleIcon }[] = [
  { id: "google", label: "Google", icon: GoogleIcon },
  { id: "microsoft", label: "Microsoft", icon: MicrosoftIcon },
  { id: "github", label: "GitHub", icon: GithubIcon },
  { id: "x", label: "X", icon: XIcon },
];

/** OAuthプロバイダのログインボタン列。LoginPageと初回セットアップウィザードの
 * 両方から使う共通部品。 */
export default function OAuthProviderButtons() {
  const { data: configured, isLoading } = useQuery({
    queryKey: ["login-providers"],
    queryFn: fetchConfiguredProviders,
  });

  const availableProviders = PROVIDERS.filter((p) => configured?.includes(p.id));
  const noProvidersConfigured = configured != null && configured.length === 0;

  return (
    <div className="grid gap-3">
      {isLoading && <p className="text-center text-sm text-muted-foreground">読み込み中...</p>}

      {noProvidersConfigured && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p>ログイン用のプロバイダが1つも設定されていません。</p>
          <p className="mt-1.5 text-xs">
            管理者は<code className="rounded bg-black/10 px-1">.env</code>にいずれかのプロバイダの
            クライアントID/シークレットを設定してください(詳細は
            <a href="/docs/admin-guide/login-setup/" className="underline">
              ログイン方法の設定
            </a>
            を参照)。
            ローカルの信頼できるネットワーク内のみで運用する場合は、
            <code className="rounded bg-black/10 px-1">AUTH_ENABLED=false</code>
            でログイン自体を無効化することもできます。
          </p>
        </div>
      )}

      {availableProviders.map((provider) => (
        <Button key={provider.id} variant="outline" size="lg" className="w-full" asChild>
          <a href={providerLoginUrl(provider.id)}>
            <provider.icon className="size-4 shrink-0" />
            {provider.label}でログイン
          </a>
        </Button>
      ))}
    </div>
  );
}
