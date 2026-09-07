import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disconnectShop, exchangeOAuthCode, fetchAuthorizeUrl, fetchOAuthStatus } from "@/api/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";

function extractAuthCode(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code) return code;
  } catch {
    // URLとして解釈できない場合はそのままコードとして扱う
  }
  return trimmed;
}

/** BASEショップ(shopId)のOAuth連携状態表示・連携/再認証/連携解除。
 * ショップ設定ページの管理カード(ShopConnectionCard)と、ショップ追加フロー
 * (ShopSetupFlow)の両方から使う共通部品。呼び出し側はplatform==="base"の
 * ときだけこれを描画する。 */
export default function ShopOAuthConnect({
  shopId,
  demoMode,
  onConnected,
}: {
  shopId: number;
  demoMode: boolean;
  onConnected?: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: oauthStatus, isLoading: oauthLoading } = useQuery({
    queryKey: ["oauth-status", shopId],
    queryFn: () => fetchOAuthStatus(shopId),
    enabled: !demoMode,
  });
  const [showAuthCode, setShowAuthCode] = useState(false);
  const [authCode, setAuthCode] = useState("");

  const authorizeMutation = useMutation({
    mutationFn: () => fetchAuthorizeUrl(shopId),
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
      setShowAuthCode(true);
    },
  });
  const exchangeMutation = useMutation({
    mutationFn: (code: string) => exchangeOAuthCode(shopId, code),
    onSuccess: () => {
      setShowAuthCode(false);
      setAuthCode("");
      queryClient.invalidateQueries({ queryKey: ["oauth-status", shopId] });
      onConnected?.();
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnectShop(shopId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oauth-status", shopId] }),
  });

  if (demoMode) {
    return (
      <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
        デモモードのため、BASEとの連携はできません(BASE接続なしで動作しています)
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {oauthLoading && <p className="text-sm text-muted-foreground">確認中...</p>}
      {oauthStatus && (
        <div className="flex items-center justify-between gap-4">
          <div>
            {oauthStatus.authenticated ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-500" />
                連携済み
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
                <span className="size-2 rounded-full bg-destructive" />
                未連携
              </span>
            )}
            {oauthStatus.authenticated && oauthStatus.refresh_token_expires_at && (
              <p className="mt-1 text-xs text-muted-foreground-subtle">
                自動更新されなかった場合の認証期限: {formatDateTime(oauthStatus.refresh_token_expires_at)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {oauthStatus.authenticated && (
              <Button variant="ghost" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
                連携解除
              </Button>
            )}
            <Button variant="outline" onClick={() => authorizeMutation.mutate()} disabled={authorizeMutation.isPending}>
              {oauthStatus.authenticated ? "再認証する" : "連携する"}
            </Button>
          </div>
        </div>
      )}

      {showAuthCode && (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <Label htmlFor={`auth_code-${shopId}`}>認証コード</Label>
          <p className="text-xs text-muted-foreground-subtle">
            開いたBASEのページでログイン・許可した後、リダイレクト先のURL(または表示されたエラー画面のアドレスバー)に含まれる
            「code=」以降の文字列(またはURL全体)をここに貼り付けてください
          </p>
          <div className="flex gap-2">
            <Input
              id={`auth_code-${shopId}`}
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              placeholder="コードまたはURLを貼り付け"
            />
            <Button
              onClick={() => exchangeMutation.mutate(extractAuthCode(authCode))}
              disabled={!authCode || exchangeMutation.isPending}
            >
              {exchangeMutation.isPending ? "認証中..." : "認証する"}
            </Button>
          </div>
          {exchangeMutation.error && (
            <p className="text-xs text-destructive">{(exchangeMutation.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  );
}
