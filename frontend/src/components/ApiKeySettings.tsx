import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { createApiKey, fetchApiKeys, revokeApiKey } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApiKeyCreateResult } from "@/types/auth";
import { formatDateTime } from "@/lib/datetime";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return formatDateTime(iso);
}

/** 外部プロジェクトからAPIキー(Authorization: Bearer usk_...)で
 * UniStockのAPIを直接叩けるようにするための発行・失効UI。人のログインを介さない
 * サーバー間連携用で、生キーは発行直後の一度しか表示されない */
export default function ApiKeySettings() {
  const queryClient = useQueryClient();
  const { data: keys, isLoading, error } = useQuery({ queryKey: ["api-keys"], queryFn: fetchApiKeys });

  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const revokeFeedback = useSaveFeedback();

  const createMutation = useMutation({
    mutationFn: () => createApiKey(name.trim()),
    onSuccess: (result) => {
      setName("");
      setCreatedKey(result);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  async function copyRawKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.raw_key);
    setCopied(true);
  }

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground-subtle">
        外部プロジェクトからログイン不要でAPIを呼び出すためのキーです。
        リクエストヘッダーに「Authorization: Bearer キー」を付けて送ってください
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
      {error && <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>}

      {keys && keys.length > 0 && (
        <div className="grid gap-1.5">
          {keys.map((k) => (
            <div key={k.id} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{k.name}</span>
                    {k.revoked_at && <Badge variant="destructive">失効済み</Badge>}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground-subtle">
                    {k.key_prefix}... ・ 作成: {formatDate(k.created_at)} ・ 最終使用: {formatDate(k.last_used_at)}
                  </div>
                </div>
                {!k.revoked_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(k.id, revokeFeedback.callbacks(String(k.id)))}
                  >
                    {revokeFeedback.isFlashing(String(k.id)) ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-4" />
                        失効させました
                      </span>
                    ) : (
                      "失効させる"
                    )}
                  </Button>
                )}
              </div>
              <FieldError message={revokeFeedback.errorFor(String(k.id))} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border-t pt-4">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="api_key_name">キーの名前</Label>
          <Input
            id="api_key_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 外部ツール連携"
          />
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending}>
          発行する
        </Button>
      </div>
      {createMutation.error && (
        <p className="text-xs text-destructive">{(createMutation.error as Error).message}</p>
      )}

      <Dialog open={createdKey !== null} onOpenChange={(open) => !open && setCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>APIキーを発行しました</DialogTitle>
            <DialogDescription>
              このキーはこの画面でしか表示されません。必ずここでコピーして安全な場所に保管してください
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={createdKey?.raw_key ?? ""} className="font-mono text-xs" />
            <Button variant="outline" onClick={copyRawKey}>
              {copied ? "コピーしました" : "コピー"}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
