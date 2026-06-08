"use client";

/*
 * Resources — enablement hub. Co-branded referral link + QR (wired to the
 * existing reseller_code attribution, kept visually distinct from enterprise
 * onboards), the marketing videos already in /public, and one-click guide +
 * deck downloads.
 */

import { useState } from "react";
import type { PortalPayload } from "./types";

const BRAND_DOMAIN =
  process.env.NEXT_PUBLIC_BRAND_DOMAIN?.replace(/\/$/, "") || "relay.green";

const VIDEOS = [
  { src: "/relay-explainer-final-v5.mp4", label: "Product overview" },
  { src: "/relay-explainer-enterprise-v1.mp4", label: "For enterprises" },
  { src: "/relay-explainer-v6-cinematic.mp4", label: "Cinematic cut" },
];

export function ResourcesView({ data }: { data: PortalPayload | null }) {
  const code = data?.reseller.code ?? "";
  const refLink = `https://${BRAND_DOMAIN}/?ref=${encodeURIComponent(code)}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(refLink)}`;
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(refLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <h1
        className="mb-7 font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Resources
      </h1>

      {/* Referral — individual signups, distinct from enterprise onboards */}
      <section className="mb-10">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Your referral link
        </h2>
        <div className="flex flex-wrap items-center gap-6">
          {code && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="Referral QR code"
              width={120}
              height={120}
              className="rounded-lg border"
              style={{ borderColor: "var(--border)" }}
            />
          )}
          <div className="min-w-0">
            <div
              className="mb-2 truncate rounded-lg border px-3 py-2 font-mono text-[13px]"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
                maxWidth: 360,
              }}
            >
              {refLink}
            </div>
            <button
              type="button"
              onClick={copy}
              className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white"
              style={{ background: "var(--primary)" }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <p
              className="mt-2 text-[12px]"
              style={{ color: "var(--text-faint)" }}
            >
              Individual signups via this link are attributed to you — separate
              from companies you onboard.
            </p>
          </div>
        </div>
      </section>

      {/* Guide + deck */}
      <section className="mb-10">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Enablement
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {/* Real files served from /public (see Relay-Partner-Deck.*). The
              prior /partner-deck.pdf + /partner-guide.pdf hrefs 404'd — no such
              files existed. A how-to guide returns here once its file is added. */}
          <Download href="/Relay-Partner-Deck.pdf" label="Partner deck (PDF)" />
          <Download
            href="/Relay-Partner-Deck.pptx"
            label="Partner deck (PowerPoint)"
          />
        </div>
      </section>

      {/* Videos */}
      <section>
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Marketing videos
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {VIDEOS.map((v) => (
            <figure key={v.src}>
              <video
                src={v.src}
                controls
                preload="metadata"
                poster="/relay-explainer-v6-poster.jpg"
                className="w-full rounded-xl border"
                style={{ borderColor: "var(--border)", aspectRatio: "16/10" }}
              />
              <figcaption
                className="mt-2 text-[13px]"
                style={{ color: "var(--text-muted)" }}
              >
                {v.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}

function Download({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="rounded-lg border px-3.5 py-2 text-[13px] font-medium"
      style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
    >
      ↓ {label}
    </a>
  );
}
