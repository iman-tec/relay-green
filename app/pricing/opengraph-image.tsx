import { ImageResponse } from "next/og";
import { OgCard, ogSize, ogContentType } from "../../lib/seo/og-template";
import { loadOgFonts } from "../../lib/seo/og-fonts";

export const alt = "Relay pricing, Free, Pro, Max, Teams";
export const size = ogSize;
export const contentType = ogContentType;

export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      eyebrow="Pricing"
      headline="One press. Four ways to commit."
      subline="Free for the first session. Pro for solo builders. Max for solo founders. Teams for 50+. Same engineer across sessions on Pro and up."
    />,
    { ...size, fonts }
  );
}
