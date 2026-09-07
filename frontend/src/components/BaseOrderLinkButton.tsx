import { ExternalLink } from "lucide-react";
import { useBaseOrderAdminUrl } from "@/lib/baseOrderUrl";
import { hasPlatformSibling } from "@/lib/platforms";
import { useShopContext } from "@/contexts/ShopContext";
import Hint from "@/components/Hint";

// 注文IDの横に添える、注文の管理画面の該当注文をブラウザの新しいタブで開くリンク。
// ショップ設定でURLテンプレートが未設定ならそもそもリンクを出さない(プラットフォーム問わず)。
// 同一プラットフォームの他ショップがある場合、管理画面はプラットフォームのアカウント
// 単位でログインするため「今ログインしているのがどのショップか」を区別できず、
// 開いても目的の注文が出るとは限らないのでリンク自体を出さない
export default function BaseOrderLinkButton({ shopId, uniqueKey }: { shopId: number; uniqueKey: string }) {
  const { shops } = useShopContext();
  const url = useBaseOrderAdminUrl(shopId, uniqueKey);
  if (!url) return null;
  if (hasPlatformSibling(shops, shopId)) return null;
  return (
    <Hint label="注文の管理画面を開く">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground-subtle hover:text-foreground"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </Hint>
  );
}
