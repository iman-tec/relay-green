import { ImageResponse } from "next/og";
import { OgCard, ogContentType } from "../lib/seo/og-template";
import { loadOgFonts } from "../lib/seo/og-fonts";

export const alt = "Relay, human engineers, in seconds";
export const size = { width: 1200, height: 600 };
export const contentType = ogContentType;

/*
 * Twitter / X large summary card. Same OgCard template, 2:1 aspect ratio.
 */
export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      eyebrow="Human engineers, in seconds"
      headline="Build with AI. Ship with engineers."
      subline="Press once. A software engineer joins your AI build in seconds."
    />,
    { ...size, fonts }
  );
}
