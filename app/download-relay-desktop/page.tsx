import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";
import { RelayLogo } from "../_marketing/RelayLogo";

export const metadata: Metadata = {
  title: "Download Relay Desktop",
  description:
    "Relay Desktop download placeholder. The actual desktop app download link will be added later.",
  alternates: { canonical: "/download-relay-desktop" },
};

export default function DownloadRelayDesktopPage() {
  return (
    <Shell>
      <section
        style={{
          minHeight: "calc(100vh - 72px)",
          display: "flex",
          alignItems: "center",
          padding: "112px 0",
          background: "#ffffff",
        }}
      >
        <div className="r-wrap" style={{ maxWidth: 920 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-mute)",
              marginBottom: 24,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "var(--green)",
                display: "inline-block",
              }}
              aria-hidden="true"
            />
            Desktop app
          </div>
          <h1
            className="r-h-display"
            style={{
              margin: 0,
              fontSize: "clamp(52px, 7vw, 96px)",
              letterSpacing: "-0.045em",
              lineHeight: 0.94,
              maxWidth: "12ch",
            }}
          >
            <RelayLogo size="0.82em" /> Desktop is coming.
          </h1>
          <p
            className="r-lede"
            style={{
              marginTop: 28,
              maxWidth: "48ch",
              fontSize: "clamp(18px, 1.7vw, 23px)",
              lineHeight: 1.38,
            }}
          >
            This is a temporary download screen. The actual Relay Desktop
            installer link will be connected here later.
          </p>
          <Link
            href="/product"
            className="r-btn r-btn-green"
            style={{ marginTop: 32 }}
          >
            Back to How it works <span className="arrow">→</span>
          </Link>
        </div>
      </section>
    </Shell>
  );
}
