// UniStockロゴ(切れ目のあるリング+中に水位のある液体)の唯一のソース。
// ヘッダーのLogoMark(AppShell.tsx、Reactコンポーネント)と、public/favicon.svgを
// 生成するscripts/generate-favicon.mjsの両方がここを読む。形や配色を変えるときは
// このファイルだけを直せばよい(favicon.svgは`npm run build`/`npm run dev`のたびに
// 自動で再生成されるため、手で2箇所を同期する必要がない)。
//
// リングのグレー2値(LOGO_GRAY_LIGHT/DARK)は、ヘッダー側でTailwindの
// zinc-700/zinc-300としても使っており、値が完全に一致している
// (favicon.svgは固定色+prefers-color-scheme、ヘッダーはアプリのテーマに
// 追従する`dark:`クラスを使うため、色の指定方法自体は別々)。
// 液体の色(LOGO_LIQUID_COLOR)はテーマに関わらず固定(モノトーンに寄せた
// グレーがかった青、Tailwind slate-500)。

export const LOGO_VIEWBOX = "0 0 32 32";

export const LOGO_RING = {
  cx: 16,
  cy: 16,
  r: 10,
  strokeWidth: 3,
  // 上中央に丸い切れ目を作る(円周2π*10≈62.8のうち9を切れ目にし、
  // rotate(-90)+dashoffsetの半分で切れ目を真上中央に揃える)
  dasharray: "53.8 9",
  dashoffset: -4.5,
  rotate: -90,
};

// リングの内周(r - strokeWidth/2 相当)に沿って液体をクリップする
export const LOGO_LIQUID_CLIP_R = 8.5;

// 液体の水面(波打つ線)。クリップ円の直径より広めに取って、円の外まで
// 塗ってからクリップする(継ぎ目が出ないようにするため)
export const LOGO_LIQUID_PATH_D = "M4,17.5 Q10,15 16,17.5 Q22,20 28,17.5 L28,30 L4,30 Z";

// Tailwind zinc-700 / zinc-300
export const LOGO_GRAY_LIGHT = "#3f3f46";
export const LOGO_GRAY_DARK = "#d4d4d8";

// Tailwind slate-500(モノトーンに寄せたグレーがかった青、テーマに関わらず固定)
export const LOGO_LIQUID_COLOR = "#64748b";
