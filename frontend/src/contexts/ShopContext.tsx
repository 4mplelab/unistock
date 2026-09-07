import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchShops } from "@/api/client";
import type { Shop } from "@/types/shop";

const STORAGE_KEY = "unistock.currentShopId";

interface ShopContextValue {
  shops: Shop[];
  isLoading: boolean;
  currentShopId: number | null;
  currentShop: Shop | null;
  setCurrentShopId: (id: number) => void;
}

const ShopContext = createContext<ShopContextValue | null>(null);

function readStoredShopId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

// アプリ全体で「今どのショップを操作対象にしているか」を1箇所で管理する。
// ヘッダーの切り替えメニューで選んだショップが、BOM編集・リストック予約作成など
// ショップに紐づく全ての画面に伝わる(各画面が個別にショップ選択を持つのをやめた)
export function ShopProvider({ children }: { children: ReactNode }) {
  const { data: shops, isLoading } = useQuery({ queryKey: ["shops"], queryFn: fetchShops });
  const [currentShopId, setCurrentShopIdState] = useState<number | null>(readStoredShopId);

  useEffect(() => {
    if (!shops) return;
    const activeShops = shops.filter((s) => s.is_active);
    const stillValid = currentShopId != null && activeShops.some((s) => s.id === currentShopId);
    if (!stillValid) {
      const fallback = activeShops[0]?.id ?? null;
      setCurrentShopIdState(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shops]);

  function setCurrentShopId(id: number) {
    setCurrentShopIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // プライベートブラウジング等で書き込めない場合は、切り替え自体は今回のセッション内で有効にする
    }
  }

  const currentShop = (shops ?? []).find((s) => s.id === currentShopId) ?? null;

  return (
    <ShopContext.Provider value={{ shops: shops ?? [], isLoading, currentShopId, currentShop, setCurrentShopId }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShopContext(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShopContext must be used within ShopProvider");
  return ctx;
}
