"use client";

/*
 * In-pane viewer for the canonical legal pages (privacy policy + terms
 * of use). Mounts the existing `/legal/privacy-policy` and
 * `/legal/terms-of-use` routes inside an iframe with `?embed=1`, which
 * tells the page's Shell to render bare (no marketing Nav/Footer).
 *
 * Why iframe vs extracting the prose into a shared component:
 *   - The legal pages are SEO-critical and have to remain crawlable as
 *     standalone routes — they're the canonical URLs Google indexes and
 *     the marketing footer links to. Keeping them as the single source
 *     of truth means an edit to the policy ships in one place and is
 *     immediately reflected wherever it's mounted.
 *   - Same-origin iframe = no CORS / postMessage ceremony. The browser
 *     handles all the styling + scrolling internally.
 *   - The legal pages use a deliberately neutral cream/light look that
 *     visually signals "this is a legal document" — they shouldn't try
 *     to recolor themselves to match the app's espresso/dark theme.
 *     The slight contrast against the room canvas reinforces "you're
 *     reading something formal" without us coding any extra cues.
 *
 * UX:
 *   - Sticky header bar inside the pane with title + close X. Mirrors
 *     AccountPane so the customer's mental model of "pane that takes
 *     over the centre + has its own close" stays consistent.
 *   - "Open in new tab" link in the header, for customers who want
 *     to print/share or read it alongside the chat.
 */

import { ExternalLink, FileText, ShieldCheck, X } from "lucide-react";

export type LegalKind = "privacy" | "terms";

const PAGE: Record<
  LegalKind,
  { title: string; path: string; Icon: typeof ShieldCheck }
> = {
  privacy: {
    title: "Privacy Policy",
    path: "/legal/privacy-policy",
    Icon: ShieldCheck,
  },
  terms: {
    title: "Terms of Use",
    path: "/legal/terms-of-use",
    Icon: FileText,
  },
};

export function LegalPane({
  kind,
  onClose,
}: {
  kind: LegalKind;
  onClose: () => void;
}) {
  const page = PAGE[kind];
  const Icon = page.Icon;

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ backgroundColor: "var(--surface)" }}
    >
      {/* Header bar — mirrors AccountPane's chrome so navigation between
          panes feels uniform. */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Icon size={14} style={{ color: "var(--primary)" }} />
          <h1
            className="truncate text-[15px] font-semibold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            {page.title}
          </h1>
        </div>

        <a
          href={page.path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] opacity-70 transition-opacity hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
          title="Open in new tab"
        >
          <ExternalLink size={12} />
          Open in new tab
        </a>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>
      </header>

      {/* Iframe — the legal page renders inside with ?embed=1 so its own
          Nav + Footer are suppressed. The cream/white background of the
          page contrasts intentionally with the dark room chrome — that's
          a feature, not a bug; it signals "formal document". */}
      <iframe
        src={`${page.path}?embed=1`}
        title={page.title}
        className="min-h-0 flex-1 border-0"
        style={{ backgroundColor: "#ffffff" }}
        // sandbox kept loose: same-origin pages we control, navigating
        // to external links (e.g. a partner's policy) needs allow-popups
        // to open in a new tab rather than the iframe.
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
      />
    </div>
  );
}
