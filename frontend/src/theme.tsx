import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "unistock.theme";

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyTheme(theme: ThemeMode, systemPrefersDark: boolean) {
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

// 初期描画前に同期的に呼び、切り替え前の一瞬だけ違うテーマが見える(FOUC)のを防ぐ
export function applyInitialTheme() {
  applyTheme(readStoredTheme(), window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(theme, query.matches);

    if (theme !== "system") return;
    const onChange = (e: MediaQueryListEvent) => applyTheme(theme, e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (next: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  };

  const value = useMemo(() => ({ theme, setTheme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
