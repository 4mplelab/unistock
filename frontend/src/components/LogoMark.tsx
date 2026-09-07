import { LOGO_LIQUID_CLIP_R, LOGO_LIQUID_COLOR, LOGO_LIQUID_PATH_D, LOGO_RING, LOGO_VIEWBOX } from "@/lib/logoMark.mjs";

// public/favicon.svgと形を共有するロゴ。形の座標はsrc/lib/logoMark.mjsが
// 唯一のソース(favicon.svgはそこからビルド時に自動生成される、generate-favicon.mjs参照)。
// 色だけはここで別指定する: 真っ黒/真っ白ではなくグレー寄りの中間色にし、
// アプリのテーマ(`dark:`クラス)に追従させる(faviconは固定色+prefers-color-schemeで
// OS/ブラウザのダーク設定に追従するため、色の指定方法自体は別々)。
// ヘッダー(AppShell)・ログイン画面・初回セットアップウィザードで共用する
export default function LogoMark({ className }: { className?: string }) {
  const { cx, cy, r, strokeWidth, dasharray, dashoffset, rotate } = LOGO_RING;
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} aria-hidden="true">
      <defs>
        <clipPath id="unistock-logo-ring-clip">
          <circle cx={cx} cy={cy} r={LOGO_LIQUID_CLIP_R} />
        </clipPath>
      </defs>
      <path d={LOGO_LIQUID_PATH_D} fill={LOGO_LIQUID_COLOR} clipPath="url(#unistock-logo-ring-clip)" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dasharray}
        strokeDashoffset={dashoffset}
        transform={`rotate(${rotate} ${cx} ${cy})`}
        className="stroke-zinc-700 dark:stroke-zinc-300"
      />
    </svg>
  );
}
