// src/lib/logoMark.mjs(ロゴの唯一のソース)からpublic/favicon.svgを生成する。
// package.jsonのbuild/dev両方から自動実行されるため、手動で叩く必要はない
// (ロゴの形・色を変えたときにfavicon.svgへの反映を忘れる、という事故を防ぐため)。
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOGO_GRAY_DARK,
  LOGO_GRAY_LIGHT,
  LOGO_LIQUID_CLIP_R,
  LOGO_LIQUID_COLOR,
  LOGO_LIQUID_PATH_D,
  LOGO_RING,
  LOGO_VIEWBOX,
} from "../src/lib/logoMark.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { cx, cy, r, strokeWidth, dasharray, dashoffset, rotate } = LOGO_RING;

const svg = `<!-- 自動生成ファイル。編集しないこと。src/lib/logoMark.mjsを直してから
     npm run build (または npm run dev) を実行すると再生成されます -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}">
  <style>
    .ring { stroke: ${LOGO_GRAY_LIGHT}; }
    @media (prefers-color-scheme: dark) {
      .ring { stroke: ${LOGO_GRAY_DARK}; }
    }
  </style>
  <defs>
    <clipPath id="ring-clip">
      <circle cx="${cx}" cy="${cy}" r="${LOGO_LIQUID_CLIP_R}"/>
    </clipPath>
  </defs>
  <path d="${LOGO_LIQUID_PATH_D}" fill="${LOGO_LIQUID_COLOR}" clip-path="url(#ring-clip)"/>
  <circle
    class="ring"
    cx="${cx}" cy="${cy}" r="${r}"
    fill="none"
    stroke-width="${strokeWidth}"
    stroke-linecap="round"
    stroke-dasharray="${dasharray}"
    stroke-dashoffset="${dashoffset}"
    transform="rotate(${rotate} ${cx} ${cy})"
  />
</svg>
`;

const outPath = resolve(__dirname, "../public/favicon.svg");
writeFileSync(outPath, svg);
console.log(`Generated ${outPath}`);
