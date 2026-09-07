import { useState } from "react";
import ComponentLabel from "@/components/ComponentLabel";
import { buttonVariants } from "@/components/ui/button";
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

export interface ComponentOption {
  id: number;
  name: string;
  group?: string | null;
  colors?: string[] | null;
  tags?: string[] | null;
  // 中間品を部品と混ぜて1つの選択肢リストに出す場合(組み合わせグリッド等)に、
  // 名前をBOM一覧等と同じ紫色(AssemblyMark参照)で区別表示するために指定する。
  // AssemblyMark自体は使わない(内部のHintツールチップがComponentLabel側の
  // ツールチップと二重になるため、色クラスだけ拝借する)
  type?: "part" | "assembly";
}

function OptionLabel({ item }: { item: ComponentOption }) {
  return (
    <span className={cn(item.type === "assembly" && "text-violet-600 dark:text-violet-400")}>
      <ComponentLabel name={item.name} group={item.group} colors={item.colors} />
    </span>
  );
}

interface Props {
  items: ComponentOption[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  // 指定すると一覧の先頭に「未選択に戻す」用の選択肢を出す(絞り込みフィルター用途)
  emptyLabel?: string;
}

// 部品/中間品をテキスト入力で絞り込みながら選べるカスタムセレクト。
// グループ・名前に加え、カラーはスウォッチ(丸)で視覚的に表示する(ネイティブ<select>では不可能なため)
export default function ComponentCombobox({
  items,
  value,
  onChange,
  placeholder = "選択してください",
  disabled,
  id,
  emptyLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "h-8 w-full min-w-0 justify-start px-2.5 text-xs font-normal"
        )}
      >
        {selected ? (
          <OptionLabel item={selected} />
        ) : emptyLabel ? (
          emptyLabel
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="名前・グループ・カラー・タグで検索" />
          <CommandList>
            <CommandEmpty className="p-3 text-sm text-muted-foreground">見つかりません</CommandEmpty>
            <CommandGroup>
              {emptyLabel && (
                <CommandItem
                  value={`__empty__ ${emptyLabel}`}
                  data-checked={value === ""}
                  className={cn(value === "" && "bg-accent text-accent-foreground")}
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  {emptyLabel}
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.group ?? ""} ${item.name} ${(item.colors ?? []).join(" ")} ${(item.tags ?? []).join(" ")}`}
                  data-checked={item.id === value}
                  className={cn(item.id === value && "bg-accent text-accent-foreground")}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <OptionLabel item={item} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
