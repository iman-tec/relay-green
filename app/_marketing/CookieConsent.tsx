"use client";

/*
 * Cookie consent banner.
 *
 * Slides in from the bottom on first visit. Stores the user's choice in
 * localStorage under "relay.cookies" so subsequent loads don't re-prompt.
 * Three actions: Accept all, Reject non-essential, customize (no-op for now ,
 * stub for the eventual /legal/cookies preference center).
 *
 * Mounted in app/layout.tsx so it appears on the first surface a visitor
 * lands on (homepage, /product, /for-enterprise, deep links from search,
 * etc.). Pairs with AnalyticsGate, which reads the same key to gate
 * Vercel Analytics until consent is given.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "relay.cookies";

// The banner is mounted in the root layout, so it shows up on the cookie
// notice page too. If we trap the user there, they can't read the very page
// they were sent to read before deciding. Bail out of the blocking modal on
// that route only — the banner still shows so the user can still choose.
const NON_BLOCKING_PATHS = new Set(["/legal/cookies"]);

type Choice = "accepted" | "rejected" | null;

function readChoice(): Choice {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "accepted" || v === "rejected") return v;
  } catch {
    // localStorage may be blocked (private mode, strict storage policies)
  }
  return null;
}

function persistChoice(choice: Exclude<Choice, null>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
    window.localStorage.setItem(`${STORAGE_KEY}.at`, new Date().toISOString());
    // Notify same-tab listeners (e.g. AnalyticsGate). The native "storage"
    // event only fires in other tabs, so dispatch a custom event here so
    // analytics can mount without a page reload after the user accepts.
    window.dispatchEvent(new CustomEvent("relay:cookies-changed"));
  } catch {
    // best-effort, banner just won't remember the choice
  }
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const blocking = visible && !NON_BLOCKING_PATHS.has(pathname ?? "");

  // Check storage after mount (avoids SSR/CSR hydration mismatch)
  useEffect(() => {
    if (readChoice() === null) {
      // Tiny defer so the banner slides in instead of popping
      const t = setTimeout(() => setVisible(true), 350);
      return () => clearTimeout(t);
    }
  }, []);

  // Lock body scroll while the consent modal is up. Restores the previous
  // overflow value so we don't stomp on any global lock (e.g. mobile nav
  // drawer) that may also manipulate it.
  useEffect(() => {
    if (!blocking) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [blocking]);

  if (!visible) return null;

  const handleAccept = () => {
    persistChoice("accepted");
    setVisible(false);
  };
  const handleReject = () => {
    persistChoice("rejected");
    setVisible(false);
  };

  return (
    <>
      <style>{`
        /* Compose translateX(-50%) into every keyframe — animating
           transform: translateY(...) on its own would replace the
           centering translateX and leave the banner left-anchored. */
        @keyframes cookie-slide-up {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes cookie-backdrop-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .cookie-backdrop {
          position: fixed;
          inset: 0;
          z-index: 99;
          /* Subtle editorial dim — readable behind, but clearly inert.
             Pair with backdrop-filter so the page softens without going
             dark, matching the site's calm/serif manner. */
          background: rgba(20, 22, 18, 0.32);
          backdrop-filter: blur(2px) saturate(0.95);
          -webkit-backdrop-filter: blur(2px) saturate(0.95);
          animation: cookie-backdrop-fade 0.42s ease both;
        }
        @media (prefers-reduced-motion: reduce) {
          .cookie-backdrop { animation: none; }
        }
        .cookie-banner {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          z-index: 100;
          width: calc(100% - 32px);
          max-width: 640px;
          background: #1a1815;
          color: #f4f2ee;
          border: 1px solid rgba(244,242,238,0.15);
          border-radius: 14px;
          padding: 20px 24px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.35);
          animation: cookie-slide-up 0.42s cubic-bezier(0.2, 0.7, 0.2, 1) both;
          font-family: var(--font-inter), system-ui, sans-serif;
        }
        .cookie-banner-row {
          display: flex;
          align-items: center;
          gap: 20px;
          flex-wrap: wrap;
        }
        .cookie-banner-text {
          flex: 1 1 280px;
          min-width: 0;
          font-size: 13.5px;
          line-height: 1.55;
          color: rgba(244,242,238,0.85);
        }
        .cookie-banner-title {
          font-family: var(--font-source-serif), Georgia, serif;
          font-weight: 500;
          font-size: 16px;
          letter-spacing: -0.005em;
          color: #f4f2ee;
          margin: 0 0 4px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .cookie-banner-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          /* Brighter brand variant, banner sits on dark ink so the
             dot matches the link and reads cleanly. */
          background: var(--green);
          display: inline-block;
        }
        .cookie-banner-link {
          /* Matches the brand-on-dark token used elsewhere on ink so
             the cookie notice link reads as the same "green" as the
             italic emphasis and the dot. */
          color: var(--green);
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .cookie-banner-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .cookie-btn {
          display: inline-flex;
          align-items: center;
          height: 36px;
          padding: 0 16px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          letter-spacing: -0.005em;
          border: 1px solid transparent;
          transition: background 0.18s ease, border-color 0.18s ease,
            color 0.18s ease;
        }
        .cookie-btn-accept {
          background: #4f6b3a;
          color: #f4f2ee;
          border-color: #4f6b3a;
        }
        .cookie-btn-accept:hover {
          background: #3f5c2e;
          border-color: #3f5c2e;
        }
        .cookie-btn-reject {
          background: transparent;
          color: rgba(244,242,238,0.85);
          border-color: rgba(244,242,238,0.25);
        }
        .cookie-btn-reject:hover {
          border-color: rgba(244,242,238,0.5);
          color: #f4f2ee;
        }
        @media (max-width: 540px) {
          .cookie-banner { padding: 16px 18px; bottom: 12px; }
          .cookie-banner-actions { width: 100%; }
          .cookie-btn { flex: 1; justify-content: center; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cookie-banner { animation: none; }
        }
      `}</style>
      {blocking && <div className="cookie-backdrop" aria-hidden="true" />}
      <div
        className="cookie-banner"
        role="dialog"
        aria-modal={blocking || undefined}
        aria-labelledby="cookie-banner-title"
        aria-describedby="cookie-banner-text"
      >
        <div className="cookie-banner-row">
          <div className="cookie-banner-text">
            <h2 id="cookie-banner-title" className="cookie-banner-title">
              <span className="cookie-banner-dot" aria-hidden="true"></span>
              Cookies
            </h2>
            <p id="cookie-banner-text" style={{ margin: 0 }}>
              We use cookies for essential session features and anonymized
              analytics. No tracking across the web. Read more in our{" "}
              <Link href="/legal/cookies" className="cookie-banner-link">
                Cookie Notice
              </Link>
              .
            </p>
          </div>
          <div className="cookie-banner-actions">
            <button
              type="button"
              className="cookie-btn cookie-btn-reject"
              onClick={handleReject}
            >
              Reject non-essential
            </button>
            <button
              type="button"
              className="cookie-btn cookie-btn-accept"
              onClick={handleAccept}
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
