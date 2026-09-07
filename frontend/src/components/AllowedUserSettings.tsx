import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { createAllowedUser, deleteAllowedUser, fetchAllowedUsers, fetchCurrentUser } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import Hint from "@/components/Hint";
import FieldError from "@/components/FieldError";
import { useSaveFeedback } from "@/hooks/useSaveFeedback";

/** UniStockへのログインを許可するアカウント(識別子=OIDCのメールアドレス、
 * Xのみ x:ユーザーID)を管理する。ここに登録されていないアカウントは
 * OAuthログインに成功してもUniStockには入れない(許可リスト方式) */
export default function AllowedUserSettings() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: fetchCurrentUser, retry: false });
  const { data: users, isLoading, error } = useQuery({ queryKey: ["allowed-users"], queryFn: fetchAllowedUsers });

  const [identifier, setIdentifier] = useState("");
  const [label, setLabel] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const createFeedback = useSaveFeedback();
  const deleteFeedback = useSaveFeedback();

  const createMutation = useMutation({
    mutationFn: () => createAllowedUser({ identifier: identifier.trim(), label: label.trim() || null, is_admin: isAdmin }),
    onSuccess: () => {
      setIdentifier("");
      setLabel("");
      setIsAdmin(false);
      queryClient.invalidateQueries({ queryKey: ["allowed-users"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAllowedUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allowed-users"] }),
  });

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground-subtle">
        識別子はGoogle/Microsoft/GitHubはメールアドレス、Xは「x:ユーザーID」の形式で登録してください
        (Xはメールアドレスを取得できないため)
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
      {error && <p className="text-sm text-destructive">読み込みに失敗しました: {(error as Error).message}</p>}

      {users && users.length > 0 && (
        <div className="grid gap-1.5">
          {users.map((u) => (
            <div key={u.id} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt="" className="size-6 shrink-0 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                      {(u.label || u.identifier).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{u.label || u.identifier}</span>
                      {u.is_admin && <Badge variant="secondary">管理者</Badge>}
                    </div>
                    {u.label && <div className="truncate text-xs text-muted-foreground-subtle">{u.identifier}</div>}
                  </div>
                </div>
                <Hint label={u.identifier === currentUser?.identifier ? "自分自身は削除できません" : null}>
                  {/* disabledなbuttonはhoverイベントを発火しないため、span側をツールチップのトリガーにする */}
                  <span className="inline-flex shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={deleteMutation.isPending || u.identifier === currentUser?.identifier}
                      onClick={() => deleteMutation.mutate(u.id, deleteFeedback.callbacks(String(u.id)))}
                    >
                      {deleteFeedback.isFlashing(String(u.id)) ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="size-4" />
                          削除しました
                        </span>
                      ) : (
                        "削除"
                      )}
                    </Button>
                  </span>
                </Hint>
              </div>
              <FieldError message={deleteFeedback.errorFor(String(u.id))} />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="allowed_user_identifier">識別子(メールアドレス等)</Label>
          <Input
            id="allowed_user_identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="user@example.com"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="allowed_user_label">表示名</Label>
          <Input
            id="allowed_user_label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="任意"
          />
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <Switch id="allowed_user_is_admin" checked={isAdmin} onCheckedChange={setIsAdmin} />
          <Label htmlFor="allowed_user_is_admin" className="whitespace-nowrap">
            管理者
          </Label>
        </div>
        <Button
          onClick={() => createMutation.mutate(undefined, createFeedback.callbacks("create"))}
          disabled={!identifier.trim() || createMutation.isPending}
        >
          {createFeedback.isFlashing("create") ? (
            <span className="inline-flex items-center gap-1">
              <Check className="size-4" />
              追加しました
            </span>
          ) : (
            "追加"
          )}
        </Button>
      </div>
      <FieldError message={createFeedback.errorFor("create")} />
    </div>
  );
}
