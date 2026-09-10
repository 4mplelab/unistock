import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { createManualOrder, fetchItemVariations, fetchOrder, updateManualOrder } from "@/api/client";
import { useShopContext } from "@/contexts/ShopContext";
import ItemCombobox, { type SelectedItem } from "@/components/ItemCombobox";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";

interface OrderLine {
  key: number;
  item: SelectedItem | null;
  quantity: string;
  variationId: number | null;
  // 編集モードの初期表示専用: サーバーはバリエーション名しか返さないため、対象商品の
  // バリエーション一覧が読み込まれた時点で名前からIDを解決するまでの間だけ保持する
  pendingVariationName?: string | null;
  // 直近に取得したこの商品のバリエーション一覧の有無(送信可否の判定用。バリエーションを
  // 持つ商品は必ずどれかを選ばないと注文できない)
  hasVariations?: boolean;
}

let nextLineKey = 1;

function newLine(): OrderLine {
  return { key: nextLineKey++, item: null, quantity: "1", variationId: null };
}

function OrderLineRow({
  shopId,
  line,
  onChange,
  onRemove,
  removable,
  hasAttemptedSubmit,
}: {
  shopId: number;
  line: OrderLine;
  onChange: (line: OrderLine) => void;
  onRemove: () => void;
  removable: boolean;
  hasAttemptedSubmit: boolean;
}) {
  const variationsQuery = useQuery({
    queryKey: ["item-variations", shopId, line.item?.item_id],
    queryFn: () => fetchItemVariations(shopId, line.item!.item_id),
    enabled: !!line.item,
  });
  const variations = variationsQuery.data ?? [];

  // 編集モードの初期値解決: バリエーション名からIDを引けたら反映する
  useEffect(() => {
    if (!line.pendingVariationName || variations.length === 0) return;
    const matched = variations.find((v) => v.variation_name === line.pendingVariationName);
    onChange({ ...line, variationId: matched ? Number(matched.variation_id) : null, pendingVariationName: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.pendingVariationName, variations.length]);

  // バリエーションを持つ商品かどうかを、送信可否の判定用に親へ伝える
  useEffect(() => {
    const hasVariations = variations.length > 0;
    if (line.hasVariations === hasVariations) return;
    onChange({ ...line, hasVariations });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variations.length]);

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-3">
      <div className="grid gap-1.5">
        <Label>商品</Label>
        <ItemCombobox
          shopId={shopId}
          value={line.item}
          onChange={(item) => onChange({ ...line, item, variationId: null, pendingVariationName: null })}
          invalid={hasAttemptedSubmit && !line.item}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>
          種類
          {variations.length > 0 && <span className="text-destructive"> *</span>}
        </Label>
        <select
          className="h-9 w-40 rounded-lg border border-input bg-card px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 dark:aria-invalid:border-destructive/50"
          value={line.variationId ?? ""}
          onChange={(e) => onChange({ ...line, variationId: e.target.value ? Number(e.target.value) : null })}
          disabled={!line.item || variations.length === 0}
          aria-invalid={hasAttemptedSubmit && variations.length > 0 && line.variationId == null}
        >
          <option value="">{variations.length === 0 ? "-" : "選択してください"}</option>
          {variations.map((v) => (
            <option key={v.variation_id} value={v.variation_id}>
              {v.variation_name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label>数量</Label>
        <NumberInput
          value={line.quantity}
          onChange={(v) => onChange({ ...line, quantity: v })}
          className="w-20 text-right"
        />
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} disabled={!removable}>
        <Trash2 />
      </Button>
    </div>
  );
}

export default function ManualOrderCreatePage() {
  const { orderId: orderIdParam } = useParams<{ orderId: string }>();
  const orderId = orderIdParam ? Number(orderIdParam) : null;
  const isEdit = orderId != null;
  const { currentShop } = useShopContext();
  const shopId = currentShop?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: existingOrder, isLoading: isLoadingOrder } = useQuery({
    queryKey: ["orders", orderId],
    queryFn: () => fetchOrder(orderId!),
    enabled: isEdit,
  });

  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [prefecture, setPrefecture] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([newLine()]);
  const [hydrated, setHydrated] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!existingOrder || hydrated) return;
    setLastName(existingOrder.last_name ?? "");
    setFirstName(existingOrder.first_name ?? "");
    setPrefecture(existingOrder.prefecture ?? "");
    setAddress(existingOrder.address ?? "");
    setEmail(existingOrder.email ?? "");
    setLines(
      existingOrder.items.map((item) => ({
        key: nextLineKey++,
        item: { item_id: item.item_id, item_name: item.title ?? item.item_id },
        quantity: String(item.quantity),
        variationId: null,
        pendingVariationName: item.variation,
      }))
    );
    setHydrated(true);
  }, [existingOrder, hydrated]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        last_name: lastName.trim() || null,
        first_name: firstName.trim() || null,
        prefecture: prefecture.trim() || null,
        address: address.trim() || null,
        email: email.trim() || null,
        items: lines
          .filter((l) => l.item)
          .map((l) => ({
            item_id: l.item!.item_id,
            quantity: Number(l.quantity || "1"),
            variation_id: l.variationId,
          })),
      };
      return isEdit ? updateManualOrder(shopId!, orderId!, payload) : createManualOrder(shopId!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate("/orders");
    },
  });

  const hasValidLine = lines.some((l) => l.item && Number(l.quantity || "0") > 0);
  const hasIncompleteVariation = lines.some((l) => l.item && l.hasVariations && l.variationId == null);

  if (!currentShop || currentShop.platform !== "manual") {
    return (
      <p className="text-sm text-muted-foreground-subtle">
        この機能は「手動管理(API連携なし)」のショップでのみ使用できます。
      </p>
    );
  }
  if (isEdit && isLoadingOrder) {
    return <p className="py-12 text-center text-sm text-muted-foreground">読み込み中...</p>;
  }

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/orders")} className="mb-2 -ml-2">
            <ArrowLeft />
            注文一覧へ戻る
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">{isEdit ? "注文を編集" : "注文を手動で追加"}</h1>
          <p className="mt-1 text-sm text-muted-foreground-subtle">
            「{currentShop.name}」の注文を{isEdit ? "編集します" : "登録します"}
          </p>
        </div>
        <Button
          onClick={() => {
            setHasAttemptedSubmit(true);
            if (hasValidLine && !hasIncompleteVariation) mutation.mutate();
          }}
          disabled={mutation.isPending}
          className="self-start"
        >
          {mutation.isPending ? (isEdit ? "更新中..." : "登録中...") : isEdit ? "注文を更新" : "注文を登録"}
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="grid gap-6 pt-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="order-last-name">姓</Label>
              <Input id="order-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="order-first-name">名</Label>
              <Input id="order-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="order-prefecture">都道府県</Label>
              <Input id="order-prefecture" value={prefecture} onChange={(e) => setPrefecture(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="order-address">住所</Label>
              <Input id="order-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid gap-1.5 col-span-2">
              <Label htmlFor="order-email">メールアドレス</Label>
              <Input id="order-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground-subtle">
            姓名・住所等はすべて任意項目です。氏名未取得のまま登録できます。
          </p>

          <div className="grid gap-3">
            <Label>
              商品 <span className="text-destructive">*</span>
            </Label>
            {lines.map((line) => (
              <OrderLineRow
                key={line.key}
                shopId={shopId!}
                line={line}
                onChange={(updated) => setLines((prev) => prev.map((l) => (l.key === line.key ? updated : l)))}
                onRemove={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                removable={lines.length > 1}
                hasAttemptedSubmit={hasAttemptedSubmit}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus />
              商品を追加
            </Button>
          </div>

          {mutation.error && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
