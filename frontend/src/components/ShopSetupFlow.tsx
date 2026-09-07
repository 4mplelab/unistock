import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createShop, seedDemoDataForShop } from "@/api/client";
import { SELECTABLE_PLATFORMS, platformHasDemoSeed } from "@/lib/platforms";
import ShopOAuthConnect from "@/components/ShopOAuthConnect";
import ShopUrlTemplates from "@/components/ShopUrlTemplates";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const selectClass =
  "h-9 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type Step = "form" | "connect" | "demo-seed";

/** ショップ追加の一連の流れ(プラットフォーム+名前 → 作成 → (showConnectStepの
 * 場合のみ)連携する/スキップ → (デモモードのみ)デモデータを投入するか選択)。
 *
 * 初回セットアップウィザード(/setup)は`showConnectStep`を立てて、ログイン後の
 * 一連の流れの中で接続設定まで一通り済ませられるようにする。一方、ヘッダーの
 * 「ショップを追加」ダイアログは新規作成のみに専念し、接続設定は/shopsページの
 * 各ショップカード(ShopConnectionCard)で個別に行う運用にする(デフォルトfalse)。 */
export default function ShopSetupFlow({
  demoMode = false,
  showConnectStep = false,
  onCreated,
  onDone,
}: {
  demoMode?: boolean;
  showConnectStep?: boolean;
  // ショップ作成が成功した時点で呼ばれる。SetupWizardPageのように「ショップが
  // 1件もなければこのページへ」というガードを親が持つ場合、作成直後にそのガードが
  // 反応して後続ステップの画面ごと追い出されてしまうのを防ぐために使う
  // (親側でこの間だけガードを止める)
  onCreated?: () => void;
  // 全ステップ完了したときに呼ばれる。作成されたshopIdを渡す
  onDone?: (shopId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState(SELECTABLE_PLATFORMS[0]?.value ?? "base");
  const [name, setName] = useState("");
  const [createdShop, setCreatedShop] = useState<{ id: number; platform: string; name: string } | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [seedDemoChecked, setSeedDemoChecked] = useState(true);

  const createShopMutation = useMutation({
    mutationFn: () => createShop({ platform, name: name.trim() }),
    onSuccess: (shop) => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      setCreatedShop({ id: shop.id, platform: shop.platform, name: shop.name });
      onCreated?.();
      if (showConnectStep) {
        setStep("connect");
      } else if (demoMode && platformHasDemoSeed(shop.platform)) {
        setStep("demo-seed");
      } else {
        finish(shop.id);
      }
    },
  });

  const seedDemoMutation = useMutation({
    mutationFn: (shopId: number) => seedDemoDataForShop(shopId),
  });

  function finish(shopId: number) {
    onDone?.(shopId);
    // ダイアログを閉じる/画面遷移する呼び出し元がほとんどだが、ショップ設定
    // ページのように部品を出しっぱなしにする場合に備えてフォーム自体もリセットする
    setCreatedShop(null);
    setStep("form");
    setSeedDemoChecked(true);
    setName("");
  }

  // 接続設定(connect)ステップの次アクション。デモモードでこのプラットフォームに
  // デモデータがあればdemo-seedステップへ、無ければそのまま完了する
  function goNextFromConnect() {
    if (!createdShop) return;
    if (demoMode && platformHasDemoSeed(createdShop.platform)) {
      setStep("demo-seed");
    } else {
      finish(createdShop.id);
    }
  }

  async function completeDemoSeedStep() {
    if (!createdShop) return;
    if (seedDemoChecked) {
      await seedDemoMutation.mutateAsync(createdShop.id);
    }
    finish(createdShop.id);
  }

  if (createdShop && step === "demo-seed") {
    return (
      <div className="grid gap-8">
        <p className="text-sm text-muted-foreground">最後に、デモ用のサンプルデータを投入しますか？</p>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={seedDemoChecked} onCheckedChange={setSeedDemoChecked} />
          デモ用のサンプルデータ(部品・BOM・注文)を投入する
        </label>
        <div className="flex items-center justify-between">
          {showConnectStep ? (
            <Button variant="ghost" onClick={() => setStep("connect")}>
              戻る
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={completeDemoSeedStep} disabled={seedDemoMutation.isPending}>
            {seedDemoMutation.isPending ? "処理中..." : "完了"}
          </Button>
        </div>
        {seedDemoMutation.error && (
          <p className="text-xs text-destructive">{(seedDemoMutation.error as Error).message}</p>
        )}
      </div>
    );
  }

  if (createdShop && step === "connect") {
    const isOAuthPlatform = createdShop.platform === "base";
    const hasNextStep = demoMode && platformHasDemoSeed(createdShop.platform);
    return (
      <div className="grid gap-8">
        <p className="text-sm text-muted-foreground">
          「{createdShop.name}」を作成しました。
          {isOAuthPlatform ? "続けて連携できます(後からでも設定できます)。" : ""}
        </p>
        {isOAuthPlatform && (
          <ShopOAuthConnect shopId={createdShop.id} demoMode={demoMode} onConnected={goNextFromConnect} />
        )}
        <ShopUrlTemplates shopId={createdShop.id} demoMode={demoMode} platform={createdShop.platform} />
        {isOAuthPlatform ? (
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={goNextFromConnect}>
              スキップ
            </Button>
            <Button onClick={goNextFromConnect}>{hasNextStep ? "次へ" : "完了"}</Button>
          </div>
        ) : (
          <Button onClick={goNextFromConnect}>{hasNextStep ? "次へ" : "完了"}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="new_shop_platform">プラットフォーム</Label>
        <select
          id="new_shop_platform"
          className={selectClass}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {SELECTABLE_PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new_shop_name">ショップ名</Label>
        <Input
          id="new_shop_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: メインショップ"
        />
      </div>
      <Button onClick={() => createShopMutation.mutate()} disabled={!name.trim() || createShopMutation.isPending}>
        作成する
      </Button>
      {createShopMutation.error && (
        <p className="text-xs text-destructive">{(createShopMutation.error as Error).message}</p>
      )}
    </div>
  );
}
