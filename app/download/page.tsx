import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";

export const metadata: Metadata = {
  title: "Relay — Desktop downloads",
  description:
    "Download the Relay desktop app for Windows. Two builds: one for customers, one for engineering staff. macOS coming soon — Linux runs in the browser.",
  alternates: { canonical: "/download" },
};

/*
 * Color tokens used on this page — all sourced from the marketing scope
 * (.mk-root in app/_marketing/marketing.css) which is what <Shell> wraps
 * us in. The marketing site is a LIGHT cream theme (--cream background +
 * --ink dark text), NOT the global dark theme. Using the global --text /
 * --surface tokens here would render cream-on-cream and read as blank.
 *
 *   --cream    #f4f2ee  page background
 *   --paper    #faf8f4  slightly lighter — used for raised cards
 *   --ink      #141413  primary text + customer CTA button bg
 *   --ink-soft #5b5b54  secondary text
 *   --ink-mute #8c8a82  metadata (file size, version strings)
 *   --rule     #d8d3c6  borders
 *   --green    #4f6b3a  engineer accent text + chip
 *   --green-deep #3f5c2e engineer CTA button bg (under cream text)
 *   --clay     #cc785c  customer accent text + chip (large only — 3:1 on cream)
 *   --clay-soft #e8c8b8 customer corner glow tint
 *   --green-tint #eaece0 engineer corner glow tint
 */

// Build type retained for the BuildCard component below; will be needed
// again when the signed Windows + macOS installers ship.
type Build = {
  audience: "Customer" | "Engineer";
  title: string;
  description: string;
  href: string;
  filename: string;
  sizeMb: number;
  accentText: string;
  accentBg: string;
  accentGlow: string;
};

// Windows installers are currently being code-signed. Until the signed
// builds ship, the BuildCard is replaced with a coming-soon panel and
// the .exe files live outside the public path
// (/public/_unreleased-downloads/, not served). When the signed builds
// are ready: restore CUSTOMER_BUILD + STAFF_DOWNLOAD constants below,
// move the files back to /public/downloads/, and replace
// <ComingSoonWindowsPanel /> in the Windows section with <BuildCard /> +
// the staff footer link.

export default function DownloadPage() {
  return (
    <Shell>
      <main className="relative mx-auto max-w-6xl px-6 py-16 sm:py-24">
        {/* Soft warm wash behind the hero — clay tinted so it nudges
            without competing with the editorial copy below */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 mx-auto h-72 max-w-3xl rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(204,120,92,0.18), transparent 70%)",
          }}
        />

        <header className="relative mb-16 text-center">
          <p
            className="mb-4 text-xs font-semibold tracking-[0.2em] uppercase"
            style={{ color: "var(--ink-soft)" }}
          >
            Desktop downloads
          </p>
          <h1
            className="text-4xl leading-[1.1] font-medium tracking-tight sm:text-5xl md:text-6xl"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
          >
            Relay on your machine.
          </h1>
          <p
            className="mx-auto mt-5 max-w-2xl text-base leading-relaxed sm:text-lg"
            style={{ color: "var(--ink-2)" }}
          >
            Native app for the people who can&apos;t afford to miss a call — and
            for the builders who want one in seconds. Pick your platform.
          </p>
        </header>

        {/* ── Windows ───────────────────────────────────────────────── */}
        <PlatformSection
          icon={<WindowsIcon />}
          title="Windows"
          subtitle="Signed 64-bit installer arriving with the next release."
        >
          <ComingSoonWindowsPanel />
        </PlatformSection>

        {/* ── macOS ─────────────────────────────────────────────────── */}
        <PlatformSection
          icon={<AppleIcon />}
          title="macOS"
          subtitle="Native Apple Silicon + Intel build."
        >
          <div
            className="relative overflow-hidden rounded-2xl border p-8 sm:p-10"
            style={{
              backgroundColor: "var(--paper)",
              borderColor: "var(--rule)",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 14px)",
                color: "var(--ink-soft)",
              }}
            />
            <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <div
                  className="mb-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase"
                  style={{
                    color: "var(--ink)",
                    borderColor: "var(--rule)",
                    backgroundColor: "var(--cream)",
                  }}
                >
                  <ClockIcon /> Coming soon
                </div>
                <h3
                  className="text-2xl font-medium"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--ink)",
                  }}
                >
                  The macOS build is on its way.
                </h3>
                <p
                  className="mt-2 text-[15px] leading-relaxed"
                  style={{ color: "var(--ink-2)" }}
                >
                  We&apos;re packaging signed universal binaries for Apple
                  Silicon and Intel. Until then, the web app gives you the full
                  experience in any modern browser.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-black/[0.04]"
                style={{
                  borderColor: "var(--ink)",
                  color: "var(--ink)",
                }}
              >
                Use the web app
                <ArrowRight />
              </Link>
            </div>
          </div>
        </PlatformSection>

        {/* ── Linux & other ─────────────────────────────────────────── */}
        <PlatformSection
          icon={<TerminalIcon />}
          title="Linux & other platforms"
          subtitle="No install needed."
        >
          <div
            className="rounded-2xl border p-8 sm:p-10"
            style={{
              backgroundColor: "var(--paper)",
              borderColor: "var(--rule)",
            }}
          >
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <h3
                  className="text-2xl font-medium"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "var(--ink)",
                  }}
                >
                  Open Relay in your browser.
                </h3>
                <p
                  className="mt-2 text-[15px] leading-relaxed"
                  style={{ color: "var(--ink-2)" }}
                >
                  Relay runs as a fully-featured web app in any modern browser.
                  Same matching, same chat, same Zoom hand-off — no install, no
                  privileged background process.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: "var(--ink)",
                  color: "var(--cream)",
                }}
              >
                Open web app
                <ArrowRight />
              </Link>
            </div>
          </div>
        </PlatformSection>

        {/* ── First-run notes ───────────────────────────────────────── */}
        <section className="mt-20">
          <h2
            className="mb-5 text-sm font-semibold tracking-[0.16em] uppercase"
            style={{ color: "var(--ink-soft)" }}
          >
            First-run notes
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            <NoteItem
              title="Sign in once"
              body="After install, sign in with your Relay account. The app keeps you signed in across launches."
            />
            <NoteItem
              title="Staff: stay signed in"
              body="The staff build keeps a hidden listener running so engineers receive native desktop notifications even when the main window is closed."
            />
            <NoteItem
              title="Customer: one-click calls"
              body="Press + in your project to ring an engineer. The app handles matching, Zoom hand-off, and chat in one window."
            />
            <NoteItem
              title="Want notice when it's ready?"
              body="Email support@relay.green and we'll add you to the desktop-launch list."
            />
          </ul>
        </section>

        {/* ── Staff build status (footer-style) ─────────────────────── */}
        <div
          className="mt-16 border-t pt-6 text-center text-[13px]"
          style={{
            borderColor: "var(--rule)",
            color: "var(--ink-soft)",
          }}
        >
          Relay engineering staff?{" "}
          <span style={{ color: "var(--green-deep)" }}>
            The staff build is in the same signing pipeline.
          </span>
          <span className="mx-1.5" style={{ color: "var(--ink-mute)" }}>
            ·
          </span>
          <a
            href="mailto:support@relay.green?subject=Relay%20Staff%20desktop%20build"
            className="underline underline-offset-2 transition-colors hover:no-underline"
            style={{ color: "var(--ink-soft)" }}
          >
            Email support
          </a>
        </div>
      </main>
    </Shell>
  );
}

/* ── Building blocks ────────────────────────────────────────────────── */

function PlatformSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="flex size-9 items-center justify-center rounded-lg border"
            style={{
              borderColor: "var(--rule)",
              color: "var(--ink)",
              backgroundColor: "var(--paper)",
            }}
          >
            {icon}
          </div>
          <div>
            <h2
              className="text-xl font-medium tracking-tight sm:text-2xl"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--ink)",
              }}
            >
              {title}
            </h2>
            <p
              className="mt-0.5 text-xs sm:text-sm"
              style={{ color: "var(--ink-soft)" }}
            >
              {subtitle}
            </p>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

function BuildCard({ build }: { build: Build }) {
  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl border p-7 transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-8"
      style={{
        backgroundColor: "var(--paper)",
        borderColor: "var(--rule)",
      }}
    >
      {/* Accent glow in the corner — soft so it reads as polish */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full opacity-60 blur-2xl"
        style={{ backgroundColor: build.accentGlow }}
      />

      <div
        className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] uppercase"
        style={{
          color: build.accentText,
          backgroundColor: "var(--cream)",
          borderColor: `color-mix(in srgb, ${build.accentText} 35%, transparent)`,
        }}
      >
        For {build.audience.toLowerCase()}s
      </div>
      <h3
        className="text-2xl font-medium"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--ink)",
        }}
      >
        {build.title}
      </h3>
      <p
        className="mt-3 flex-1 text-[15px] leading-relaxed"
        style={{ color: "var(--ink-2)" }}
      >
        {build.description}
      </p>

      <div
        className="mt-5 flex items-center justify-between font-mono text-[11px]"
        style={{ color: "var(--ink-mute)" }}
      >
        <span>{build.filename}</span>
        <span>{build.sizeMb} MB</span>
      </div>

      <a
        href={build.href}
        download={build.filename}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
        style={{
          backgroundColor: build.accentBg,
          color: "var(--cream)",
        }}
      >
        <DownloadIcon />
        Download for Windows
      </a>
    </div>
  );
}

// Coming-soon panel for the Windows section. Mirrors the existing
// macOS panel's layout so the page reads as two parallel "in flight"
// platforms rather than two ad-hoc messages. Keep the visual rhyme.
function ComingSoonWindowsPanel() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-8 sm:p-10"
      style={{
        backgroundColor: "var(--paper)",
        borderColor: "var(--rule)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 14px)",
          color: "var(--ink-soft)",
        }}
      />
      <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <div
            className="mb-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase"
            style={{
              color: "var(--ink)",
              borderColor: "var(--rule)",
              backgroundColor: "var(--cream)",
            }}
          >
            <ClockIcon /> Coming soon
          </div>
          <h3
            className="text-2xl font-medium"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--ink)",
            }}
          >
            The Windows build is in code-signing.
          </h3>
          <p
            className="mt-2 text-[15px] leading-relaxed"
            style={{ color: "var(--ink-2)" }}
          >
            We&apos;re finalizing an Authenticode-signed installer so Windows
            won&apos;t flag it on first launch. Until that ships, the web app
            gives you the full experience in any modern browser.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-black/[0.04]"
          style={{
            borderColor: "var(--ink)",
            color: "var(--ink)",
          }}
        >
          Use the web app
          <ArrowRight />
        </Link>
      </div>
    </div>
  );
}

function NoteItem({ title, body }: { title: string; body: string }) {
  return (
    <li
      className="rounded-xl border p-5"
      style={{
        backgroundColor: "var(--paper)",
        borderColor: "var(--rule)",
      }}
    >
      <div
        className="text-[15px] font-semibold"
        style={{ color: "var(--ink)" }}
      >
        {title}
      </div>
      <p
        className="mt-1.5 text-[14px] leading-relaxed"
        style={{ color: "var(--ink-2)" }}
      >
        {body}
      </p>
    </li>
  );
}

/* ── Inline SVG icons ────────────────────────────────────────────────── */

function WindowsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3 5.7 10.5 4.5v7.5H3V5.7zM11.5 4.4 21 3v9h-9.5V4.4zM3 13h7.5v7.3L3 19V13zm8.5 0H21v9l-9.5-1.3V13z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.5 12.6c0-2.7 2.2-4 2.3-4.1-1.2-1.8-3.2-2-3.9-2.1-1.7-.2-3.2 1-4.1 1-.9 0-2.2-1-3.6-1-1.9 0-3.6 1.1-4.5 2.8-1.9 3.3-.5 8.2 1.4 10.9.9 1.3 2 2.7 3.4 2.7 1.4-.1 1.9-.9 3.5-.9 1.7 0 2.1.9 3.6.9 1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.5-3 1.5-3.1-.1-.1-2.9-1.1-2.9-4.5zM14.8 4.4c.8-.9 1.3-2.2 1.1-3.4-1.1 0-2.4.7-3.2 1.6-.7.8-1.3 2.1-1.2 3.3 1.2.1 2.4-.6 3.3-1.5z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
