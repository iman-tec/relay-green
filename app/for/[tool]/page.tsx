/*
 * /for/<tool>, tool-specific landing page.
 *
 * One dynamic route, nine pre-rendered pages (one per supported AI track).
 * The copy comes from lib/tools.ts; the chrome comes from <ToolLandingPage>.
 *
 * generateStaticParams pre-renders every supported tool at build time so the
 * pages are 100% static (no runtime DB / fetch / cache concerns) and
 * instantly indexable. Anything not in TOOL_SLUGS returns a 404 via
 * notFound(), which is what we want for SEO hygiene.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolLandingPage } from "../../_marketing/ToolLandingPage";
import { TOOLS, TOOL_SLUGS } from "../../../lib/tools";

type RouteProps = { params: Promise<{ tool: string }> };

export function generateStaticParams() {
  return TOOL_SLUGS.map((tool) => ({ tool }));
}

export async function generateMetadata({
  params,
}: RouteProps): Promise<Metadata> {
  const { tool: slug } = await params;
  const tool = TOOLS[slug];
  if (!tool) return {};
  return {
    title: `Relay for ${tool.name}, Press the dot when ${tool.name} needs a person`,
    description: tool.metaDescription,
    alternates: { canonical: `/for/${tool.slug}` },
    openGraph: {
      title: `Relay for ${tool.name}`,
      description: tool.metaDescription,
      url: `/for/${tool.slug}`,
    },
  };
}

export default async function Page({ params }: RouteProps) {
  const { tool: slug } = await params;
  const tool = TOOLS[slug];
  if (!tool) notFound();
  return <ToolLandingPage tool={tool} />;
}
