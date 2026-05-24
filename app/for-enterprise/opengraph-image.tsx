import { ImageResponse } from "next/og";
import { OgCard, ogSize, ogContentType } from "../../lib/seo/og-template";
import { loadOgFonts } from "../../lib/seo/og-fonts";

export const alt = "Relay for Enterprise, govern the AI your team is using";
export const size = ogSize;
export const contentType = ogContentType;

/*
 * Per-page Open Graph card for /for-enterprise. Override of the default
 * cream card so the share preview names the audience and the value rather
 * than the brand default. Same OgCard template + ogFonts as /pricing and
 * /product.
 */
export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      eyebrow="For Enterprise"
      headline="Govern the AI your team is already using."
      subline="Real engineers, in seconds, under your NDA, in your region, on your audit trail. SOC 2 aligned, GDPR aware, governed by default."
    />,
    { ...size, fonts }
  );
}
