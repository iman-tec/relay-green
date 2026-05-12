/*
 * Font loader for ImageResponse-rendered OG cards.
 *
 * Reads WOFF binaries from @fontsource at build time and exposes them as
 * an array ready to feed into ImageResponse's `fonts` option. Satori (the
 * renderer behind next/og) supports WOFF1 directly; WOFF2 requires extra
 * decompression so we deliberately use WOFF1 here.
 *
 * Loading once per OG generation is fine — Next.js caches the OG output by
 * default (these are statically optimized routes), so this readFile only
 * happens at build time, not on every request.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FONTSOURCE_INTER = "node_modules/@fontsource/inter/files";
const FONTSOURCE_SOURCE_SERIF = "node_modules/@fontsource/source-serif-4/files";

export type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600;
  style: "normal" | "italic";
};

let cachedFonts: OgFont[] | null = null;

export async function loadOgFonts(): Promise<OgFont[]> {
  if (cachedFonts) return cachedFonts;

  const cwd = process.cwd();
  const [interMedium, interSemiBold, sourceSerifMedium] = await Promise.all([
    readFile(join(cwd, FONTSOURCE_INTER, "inter-latin-500-normal.woff")),
    readFile(join(cwd, FONTSOURCE_INTER, "inter-latin-600-normal.woff")),
    readFile(
      join(cwd, FONTSOURCE_SOURCE_SERIF, "source-serif-4-latin-500-normal.woff")
    ),
  ]);

  cachedFonts = [
    { name: "Inter", data: interMedium, weight: 500, style: "normal" },
    { name: "Inter", data: interSemiBold, weight: 600, style: "normal" },
    {
      name: "Source Serif 4",
      data: sourceSerifMedium,
      weight: 500,
      style: "normal",
    },
  ];

  return cachedFonts;
}
