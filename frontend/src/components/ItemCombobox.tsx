import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchItem, fetchItems } from "@/api/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

export interface SelectedItem {
  item_id: string;
  item_name: string;
}

interface Props {
  shopId: number;
  value: SelectedItem | null;
  onChange: (value: SelectedItem | null) => void;
  // 選択済みの商品を変更できないようにする(既存BOMの編集画面など、商品IDを
  // 後から差し替える操作自体が成立しない場面向け)。「変更」ボタン自体を出さない
  locked?: boolean;
  // 選択肢から除外する商品ID(BOMの複製元・すでにBOMが登録済みの商品を
  // 複製先候補から外す、といった用途)
  excludeItemIds?: Set<string>;
  // 未選択のまま送信しようとした場合などに、選択ボタンを赤枠で示す
  invalid?: boolean;
}

export default function ItemCombobox({
  shopId,
  value,
  onChange,
  locked = false,
  excludeItemIds,
  invalid,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 「変更」ボタン押下時、実際に新しい商品を選び終えるまでは選択中の値を消さない
  // (以前はボタンを押した瞬間にonChange(null)していたため、ポップオーバーを閉じただけで
  // 何も選ばなくても入力済みの内容が失われてしまっていた)
  const [reselecting, setReselecting] = useState(false);

  const itemsQuery = useQuery({ queryKey: ["items", shopId], queryFn: () => fetchItems(shopId) });

  const lookupMutation = useMutation({
    mutationFn: (itemId: string) => fetchItem(shopId, itemId),
  });

  function confirm(itemId: string, title: string) {
    onChange({ item_id: itemId, item_name: title });
    setReselecting(false);
    setOpen(false);
    setSearch("");
    lookupMutation.reset();
  }

  async function handleManualLookup(itemId: string) {
    const item = await lookupMutation.mutateAsync(itemId);
    if (item) {
      confirm(item.item_id, item.title);
    }
  }

  if (value && !reselecting) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{value.item_name}</div>
          <div className="font-mono text-xs text-muted-foreground">{value.item_id}</div>
        </div>
        {!locked && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setReselecting(true);
              setOpen(true);
            }}
          >
            変更
          </Button>
        )}
      </div>
    );
  }

  const items = (itemsQuery.data ?? []).filter((i) => !excludeItemIds?.has(i.item_id));
  const exactMatch = items.some((i) => i.item_id === search);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 何も選ばずに閉じた場合は「変更」前の表示に戻す(選択中の値はそのまま保持される)
        if (!next) setReselecting(false);
      }}
    >
      <PopoverTrigger
        type="button"
        aria-invalid={invalid}
        className={cn(buttonVariants({ variant: "outline" }), "w-full justify-start font-normal")}
      >
        商品を選択...
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={!!search}>
          <CommandInput
            placeholder="商品ID・商品名で検索、または直接ID入力"
            value={search}
            onValueChange={(v) => {
              setSearch(v);
              lookupMutation.reset();
            }}
          />
          <CommandList>
            {itemsQuery.isLoading && <div className="p-4 text-sm text-muted-foreground">読み込み中...</div>}
            {lookupMutation.isPending && (
              <div className="p-4 text-sm text-muted-foreground">「{search}」を確認中...</div>
            )}
            {lookupMutation.isSuccess && lookupMutation.data === null && (
              <div className="p-4 text-sm text-destructive">
                商品が見つかりません: {lookupMutation.variables}
              </div>
            )}
            {!lookupMutation.isPending && (
              <>
                <CommandEmpty className="p-2">
                  {search ? (
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => handleManualLookup(search)}
                    >
                      「{search}」をIDとして直接指定
                    </button>
                  ) : (
                    "商品がありません"
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {items.map((item) => (
                    <CommandItem
                      key={item.item_id}
                      value={`${item.item_id} ${item.title}`}
                      onSelect={() => confirm(item.item_id, item.title)}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{item.item_id}</span>
                      <span className="truncate">{item.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        在庫{formatNumber(item.stock)}
                      </span>
                    </CommandItem>
                  ))}
                  {search && !exactMatch && (
                    <CommandItem
                      value={`__manual__ ${search}`}
                      onSelect={() => handleManualLookup(search)}
                    >
                      「{search}」をIDとして直接指定
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
