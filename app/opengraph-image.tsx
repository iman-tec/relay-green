import { ImageResponse } from "next/og";
import { OgCard, ogSize, ogContentType } from "../lib/seo/og-template";
import { loadOgFonts } from "../lib/seo/og-fonts";

export const alt = "Relay, human engineers, in seconds";
export const size = ogSize;
export const contentType = ogContentType;

/*
 * Default Open Graph card. Used for any route that doesn't define its own
 * colocated opengraph-image, see /pricing/opengraph-image.tsx and the
 * dynamic /for/[tool]/opengraph-image.tsx for examples of overrides.
 */
export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      eyebrow="Human engineers, in seconds"
      headline="Build with AI. Ship with engineers."
      subline="Press once. A software engineer joins your AI build in seconds, and stays with you from build to shipped to running."
    />,
    { ...size, fonts }
  );
}
