import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

const PAGE_SIZE_KEY = "unistock.page_size";
const PAGE_SIZE_OPTIONS = [20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

export function usePageSize(): [number, (size: number) => void] {
  const [pageSize, setPageSizeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(PAGE_SIZE_KEY);
      const parsed = raw ? Number(raw) : NaN;
      return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
    } catch {
      return DEFAULT_PAGE_SIZE;
    }
  });

  function setPageSize(size: number) {
    setPageSizeState(size);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      // localStorageが使えない環境(プライベートモード等)では保存をスキップする
    }
  }

  return [pageSize, setPageSize];
}

interface Props {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({ page, pageCount, pageSize, total, onPageChange, onPageSizeChange }: Props) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {page} / {pageCount} ページ（全{formatNumber(total)}件）
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}件/ページ
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          前へ
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          次へ
        </Button>
      </div>
    </div>
  );
}
