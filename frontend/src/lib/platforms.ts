import { PencilLine, Store, type LucideIcon } from "lucide-react";
import type { Shop } from "@/types/shop";

export interface PlatformInfo {
  value: string;
  label: string;
  // このプロバイダの実装(IECProvider)が実際に動くかどうか。falseのものは
  // ショップ追加フォームの選択肢には出さない(将来実装したらtrueにするだけでよい)
  implemented: boolean;
  // 実際のブランドロゴはOSS公開する都合上ライセンス的なリスクがあるため使わず、
  // lucide-reactの汎用アイコンで視覚的に区別するだけに留める
  icon: LucideIcon;
  // デモモードでこのプラットフォームのショップを作ったとき、ShopSetupFlowの
  // 「デモ用のサンプルデータを投入する」ステップを出すかどうか。バックエンドの
  // demo_seed_service.has_demo_seeder()と対応させる
  hasDemoSeed: boolean;
}

export const PLATFORMS: PlatformInfo[] = [
  { value: "base", label: "BASE", implemented: true, hasDemoSeed: true, icon: Store },
  // 外部連携APIを持たないサイト向け。商品/注文は手動フォーム・CSVで直接登録する
  { value: "manual", label: "手動管理(API連携なし)", implemented: true, hasDemoSeed: true, icon: PencilLine },
];

// ショップ追加フォームの選択肢はここに絞る
export const SELECTABLE_PLATFORMS = PLATFORMS.filter((p) => p.implemented);

export function platformLabel(value: string): string {
  return PLATFORMS.find((p) => p.value === value)?.label ?? value;
}

export function platformHasDemoSeed(value: string): boolean {
  return PLATFORMS.find((p) => p.value === value)?.hasDemoSeed ?? false;
}

// 同じプラットフォームのショップが他にもあるかどうか。管理画面(admin.thebase.com等)は
// プラットフォームのアカウント単位でブラウザにログインするため、同一プラットフォームの
// ショップが複数あると「今ログインしているのがどのショップのアカウントか」を
// 区別できず、外部管理画面リンクを開いても目的の情報が出るとは限らない
export function hasPlatformSibling(shops: Shop[], shopId: number): boolean {
  const platform = shops.find((s) => s.id === shopId)?.platform;
  if (!platform) return false;
  return shops.filter((s) => s.platform === platform).length > 1;
}
