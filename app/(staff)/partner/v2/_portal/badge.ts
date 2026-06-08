/*
 * "Relay Certified Partner" badge — generated SVG, downloadable as SVG or PNG.
 * Brand-correct: white card, Relay green, the wordmark dot. Versioned via the
 * reseller's badge_version (passed through for cache-busting / reissue).
 */

import { TIER_LABEL, type PartnerTier } from "@/lib/billing/partnerTiers";

const W = 520;
const H = 300;

export function buildBadgeSvg(opts: {
  tier: PartnerTier;
  year: number;
  org: string;
}): string {
  const tierLabel = TIER_LABEL[opts.tier];
  const green = "#16a34a";
  const ink = "#14171a";
  const muted = "#5b6470";
  // Hairline card on white; one green dot + wordmark; tier in serif; year as meta.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Relay Certified ${tierLabel}">
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="#ffffff" stroke="#e6eae8" stroke-width="2"/>
  <g transform="translate(40,44)">
    <circle cx="9" cy="9" r="9" fill="${green}"/>
    <text x="26" y="15" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="600" fill="${ink}">Relay</text>
    <text x="86" y="15" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="400" fill="${muted}">Partners</text>
  </g>
  <text x="40" y="150" font-family="'Source Serif 4', Georgia, serif" font-size="42" font-weight="600" fill="${ink}">Certified ${tierLabel}</text>
  <text x="40" y="186" font-family="Inter, Arial, sans-serif" font-size="16" fill="${muted}">${escapeXml(opts.org)}</text>
  <line x1="40" y1="222" x2="${W - 40}" y2="222" stroke="#e6eae8" stroke-width="1.5"/>
  <text x="40" y="256" font-family="'JetBrains Mono', monospace" font-size="13" letter-spacing="0.04em" fill="${muted}">RELAY.GREEN · ${opts.year}</text>
  <text x="${W - 40}" y="256" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="500" fill="${green}">Verified partner</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      (
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          "'": "&apos;",
          '"': "&quot;",
        }) as Record<string, string>
      )[c]
  );
}

export function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  triggerDownload(URL.createObjectURL(blob), filename);
}

/** Rasterize the SVG to a 2× PNG via an offscreen canvas. */
export function downloadPng(svg: string, filename: string) {
  const scale = 2;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(URL.createObjectURL(blob), filename);
    }, "image/png");
  };
  img.src = url;
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
