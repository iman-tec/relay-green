import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { OgCard, ogSize, ogContentType } from "../../../lib/seo/og-template";
import { loadOgFonts } from "../../../lib/seo/og-fonts";
import { TOOLS } from "../../../lib/tools";

export const alt = "Relay, Human engineers, in seconds";
export const size = ogSize;
export const contentType = ogContentType;

/*
 * Per-tool OG card for /for/<tool>. Next.js calls this default-export once
 * per static route (one per tool slug, since the parent page exports
 * generateStaticParams for the same set), so we get nine pre-rendered OG
 * images at build time without any extra metadata wiring.
 *
 * NOTE: do NOT add generateImageMetadata here. That helper is for routes
 * that emit *multiple* OG images per URL (e.g. hero + thumbnail). For a
 * dynamic segment, the default function paired with params is enough.
 */

type Props = { params: Promise<{ tool: string }> };

export default async function Image({ params }: Props) {
  const { tool: slug } = await params;
  const tool = TOOLS[slug];
  if (!tool) notFound();

  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      eyebrow={`For ${tool.vendor}`}
      headline={`Stuck in ${tool.name}? Press the dot.`}
      subline={tool.oneLiner}
    />,
    { ...size, fonts }
  );
}
