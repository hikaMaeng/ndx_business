/*
 * `tsc` emits JavaScript and nothing else, so the theme stylesheet would never
 * reach `dist` — and `dist` is what the exports map points at, which is what
 * both apps resolve. Copying it here keeps the package's published shape honest
 * rather than making consumers reach into `src`.
 */
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/front/theme", { recursive: true });
await cp("src/front/theme/theme.css", "dist/front/theme/theme.css");
