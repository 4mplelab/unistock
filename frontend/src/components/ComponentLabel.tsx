import { useEffect, useRef, useState } from "react";
import GroupChip from "@/components/GroupChip";
import PartColorSwatches from "@/components/PartColorSwatches";
import TagBadge from "@/components/TagBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  name: string;
  group?: string | null;
  colors?: string[] | null;
  tags?: string[] | null;
}

// 部品/中間品の名称を、グループ(チップ)・カラー(スウォッチ)と横並びで表示する共通コンポーネント。
// 一覧・BOM編集・中間品レシピ編集など、部品を選んだ結果を表示する箇所で共通利用する。
// タグは名前と同じ行に並べると視認性が落ちる(どれが名前でどれがタグか分かりにくい)ため、
// 部品一覧と同じく1段下に、より小さいバッジで表示する
export default function ComponentLabel({ name, group, colors, tags }: Props) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const checkTruncated = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    checkTruncated();
    const observer = new ResizeObserver(checkTruncated);
    observer.observe(el);
    return () => observer.disconnect();
  }, [name]);

  const title = [
    name,
    group,
    colors && colors.length > 0 ? colors.join("・") : null,
    tags && tags.length > 0 ? tags.join("・") : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span ref={nameRef} className="min-w-0 truncate group-hover:underline">
              {name}
            </span>
            {group && <GroupChip group={group} />}
            {colors && colors.length > 0 && <PartColorSwatches colors={colors} />}
          </span>
          {tags && tags.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {tags.map((t) => (
                <TagBadge key={t} tag={t} className="h-4 px-1.5 text-[10px]" />
              ))}
            </span>
          )}
        </span>
      </TooltipTrigger>
      {/* 名前が省略(truncate)されているときだけツールチップを出す。省略されていないのに
          即座にツールチップが出るのはうるさいという指摘のため */}
      {isTruncated && <TooltipContent>{title}</TooltipContent>}
    </Tooltip>
  );
}
