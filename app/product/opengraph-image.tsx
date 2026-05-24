import { ImageResponse } from "next/og";
import { OgCard, ogSize, ogContentType } from "../../lib/seo/og-template";
import { loadOgFonts } from "../../lib/seo/og-fonts";

export const alt = "Relay, how it works";
export const size = ogSize;
export const contentType = ogContentType;

/*
 * Per-page Open Graph card for /product. Override of the default cream
 * card so a share-link preview names the page rather than the brand
 * default. Same OgCard template + ogFonts as /pricing and /for/[tool].
 */
export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      eyebrow="How it works"
      headline="One press. One engineer. From stuck to solution ready."
      subline="Press, Match, Join, Solve, Deploy, Maintain. Three phases, one team, the whole way."
    />,
    { ...size, fonts }
  );
}
