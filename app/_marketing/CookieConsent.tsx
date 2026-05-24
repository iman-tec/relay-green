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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legalDoc, setLegalDoc] = useState<null | "privacy" | "terms">(null);
  const [preferences, setPreferences] = useState({
    functional: true,
    analytics: true,
    marketing: false,
  });
  const pathname = usePathname();
  const blocking = visible && !NON_BLOCKING_PATHS.has(pathname ?? "");

  // Check storage after mount (avoids SSR/CSR hydration mismatch).
  // ALSO skip rendering when this app is loaded inside an iframe — the
  // legal-preview modal below embeds /legal/privacy-policy and
  // /legal/terms-of-use in iframes, and without this guard the banner
  // would recurse inside its own preview.
  useEffect(() => {
    if (window.self !== window.top) return;
    if (readChoice() === null) {
      // Tiny defer so the banner slides in instead of popping
      const t = setTimeout(() => setVisible(true), 350);
      return () => clearTimeout(t);
    }
  }, []);

  // GDPR right-to-withdraw: the footer's "Manage cookie preferences"
  // link dispatches "relay:cookies-reopen" on the same tab, which
  // re-mounts the banner with the user's current saved preferences
  // pre-selected. Settings panel opens immediately so the user can
  // see + change choices rather than being asked Accept/Reject again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.self !== window.top) return;
    const onReopen = () => {
      try {
        const raw = window.localStorage.getItem(`${STORAGE_KEY}.settings`);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<{
            functional: boolean;
            analytics: boolean;
            marketing: boolean;
          }>;
          setPreferences((p) => ({
            functional: saved.functional ?? p.functional,
            analytics: saved.analytics ?? p.analytics,
            marketing: saved.marketing ?? p.marketing,
          }));
        }
      } catch {
        // ignore; fall through with defaults
      }
      setSettingsOpen(true);
      setVisible(true);
    };
    window.addEventListener("relay:cookies-reopen", onReopen);
    return () => window.removeEventListener("relay:cookies-reopen", onReopen);
  }, []);

  // Escape closes the legal preview modal (but not the cookie banner —
  // the user must explicitly Accept or Save settings to dismiss that).
  useEffect(() => {
    if (!legalDoc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLegalDoc(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [legalDoc]);

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
    try {
      window.localStorage.setItem(
        `${STORAGE_KEY}.settings`,
        JSON.stringify({
          strictlyNecessary: true,
          functional: true,
          analytics: true,
          marketing: true,
        })
      );
    } catch {
      // best-effort preference detail
    }
    persistChoice("accepted");
    setVisible(false);
  };

  const handleSaveSettings = () => {
    try {
      window.localStorage.setItem(
        `${STORAGE_KEY}.settings`,
        JSON.stringify({
          strictlyNecessary: true,
          functional: preferences.functional,
          analytics: preferences.analytics,
          marketing: preferences.marketing,
        })
      );
    } catch {
      // best-effort preference detail
    }
    persistChoice(
      preferences.analytics || preferences.marketing ? "accepted" : "rejected"
    );
    setVisible(false);
  };

  return (
    <>
      <style>{`
        /* Compose translateX(-50%) into every keyframe — animating
           transform: translateY(...) on its own would replace the
           centering translateX and leave the banner left-anchored. */
        @keyframes cookie-slide-up {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 20px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
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
          background: rgba(245, 245, 247, 0.6);
          backdrop-filter: blur(8px) saturate(0.92);
          -webkit-backdrop-filter: blur(8px) saturate(0.92);
          animation: cookie-backdrop-fade 0.42s ease both;
        }
        @media (prefers-reduced-motion: reduce) {
          .cookie-backdrop { animation: none; }
        }
        .cookie-banner {
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 100;
          width: calc(100% - 32px);
          max-width: 620px;
          background: #ffffff;
          color: #1d1d1f;
          border: 1px solid #d2d2d7;
          border-radius: 8px;
          padding: 28px;
          box-shadow: 0 24px 72px rgba(0,0,0,0.18);
          animation: cookie-slide-up 0.42s cubic-bezier(0.2, 0.7, 0.2, 1) both;
          font-family: var(--font-inter), system-ui, sans-serif;
        }
        .cookie-banner-row {
          display: flex;
          align-items: flex-start;
          gap: 22px;
          flex-wrap: wrap;
        }
        .cookie-banner-text {
          flex: 1 1 100%;
          min-width: 0;
          font-size: 14px;
          line-height: 1.62;
          color: #424245;
        }
        .cookie-banner-title {
          font-family: var(--font-source-serif), Georgia, serif;
          font-weight: 500;
          font-size: 28px;
          line-height: 1.08;
          letter-spacing: -0.005em;
          color: #1d1d1f;
          margin: 0 0 12px;
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
          /* Reset native button chrome so the inline-button reads as
             a textual link (Privacy / Terms open in a modal preview
             instead of navigating away from the consent flow). */
          background: transparent;
          border: 0;
          padding: 0;
          font: inherit;
          /* Matches the brand-on-dark token used elsewhere on ink so
             the cookie notice link reads as the same "green" as the
             italic emphasis and the dot. */
          color: var(--green);
          text-decoration: underline;
          text-underline-offset: 3px;
          cursor: pointer;
        }
        .cookie-banner-link:hover {
          color: var(--green-deep, var(--green));
        }
        /* Legal-preview modal. Stacked above the cookie banner so the
           user can read /legal/privacy-policy or /legal/terms-of-use
           in front of the consent dialog and close back to it without
           losing the unresolved consent state. */
        .cookie-legal-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .cookie-legal-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(20, 20, 24, 0.55);
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          cursor: pointer;
          animation: cookie-backdrop-fade 0.28s ease both;
        }
        .cookie-legal-panel {
          position: relative;
          width: min(960px, calc(100vw - 32px));
          height: min(85vh, 85dvh);
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 32px 96px rgba(0, 0, 0, 0.4);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: cookie-legal-pop 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }
        .cookie-legal-close {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 2;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid #d2d2d7;
          background: rgba(255, 255, 255, 0.96);
          color: #1d1d1f;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
          transition:
            background 0.18s ease,
            border-color 0.18s ease,
            color 0.18s ease;
        }
        .cookie-legal-close:hover {
          background: #1d1d1f;
          color: #ffffff;
          border-color: #1d1d1f;
        }
        .cookie-legal-iframe {
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
          background: #ffffff;
        }
        @keyframes cookie-legal-pop {
          from {
            opacity: 0;
            transform: scale(0.96);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cookie-legal-panel,
          .cookie-legal-backdrop {
            animation: none;
          }
        }
        @media (max-width: 540px) {
          .cookie-legal-overlay {
            padding: 0;
          }
          .cookie-legal-panel {
            width: 100vw;
            height: 100dvh;
            border-radius: 0;
          }
        }
        .cookie-banner-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
          flex-wrap: wrap;
          width: 100%;
          justify-content: flex-end;
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
          background: #111111;
          color: #ffffff;
          border-color: #4d6b40;
        }
        .cookie-btn-accept:hover {
          background: #2b2b2d;
          border-color: #2b2b2d;
        }
        .cookie-btn-reject {
          background: transparent;
          color: #1d1d1f;
          border-color: #d2d2d7;
        }
        .cookie-btn-reject:hover {
          border-color: #86868b;
          color: #1d1d1f;
        }
        .cookie-settings {
          width: 100%;
          border: 1px solid #d2d2d7;
          border-radius: 8px;
          overflow: hidden;
          margin-top: 18px;
          background: #f5f5f7;
        }
        .cookie-setting {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: center;
          padding: 14px 16px;
          border-bottom: 1px solid #d2d2d7;
          background: #ffffff;
        }
        .cookie-setting:last-child {
          border-bottom: none;
        }
        .cookie-setting strong {
          display: block;
          font-size: 14px;
          color: #1d1d1f;
          margin-bottom: 3px;
        }
        .cookie-setting span {
          display: block;
          font-size: 12.5px;
          line-height: 1.45;
          color: #6e6e73;
        }
        .cookie-setting input {
          width: 18px;
          height: 18px;
          accent-color: var(--green);
        }
        @media (max-width: 540px) {
          .cookie-banner { padding: 22px 18px; top: 50%; max-height: calc(100dvh - 32px); overflow: auto; }
          .cookie-banner-actions { width: 100%; justify-content: stretch; flex-direction: column; }
          .cookie-btn { width: 100%; min-height: 42px; justify-content: center; white-space: normal; text-align: center; }
          .cookie-setting { grid-template-columns: 1fr; }
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
              We value your privacy.
            </h2>
            <p id="cookie-banner-text" style={{ margin: 0 }}>
              This website uses cookies and similar technologies to improve your
              browsing experience, measure our audience, collect useful
              information, and provide you with relevant content. By selecting
              “Accept & Continue”, you confirm that you provide your consent for
              the use of your information, and have read and agree to our{" "}
              <button
                type="button"
                className="cookie-banner-link"
                onClick={() => setLegalDoc("privacy")}
              >
                Privacy Policy
              </button>{" "}
              and{" "}
              <button
                type="button"
                className="cookie-banner-link"
                onClick={() => setLegalDoc("terms")}
              >
                Terms of Use
              </button>
              .
            </p>
            {settingsOpen && (
              <div className="cookie-settings" aria-label="Cookie settings">
                <label className="cookie-setting">
                  <span>
                    <strong>Strictly necessary</strong>
                    Required for security, consent storage, and core website
                    functionality.
                  </span>
                  <input type="checkbox" checked disabled />
                </label>
                <label className="cookie-setting">
                  <span>
                    <strong>Functional</strong>
                    Remembers preferences and improves usability across visits.
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.functional}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        functional: e.target.checked,
                      }))
                    }
                  />
                </label>
                <label className="cookie-setting">
                  <span>
                    <strong>Analytics</strong>
                    Helps us measure audience, performance, and site quality.
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.analytics}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        analytics: e.target.checked,
                      }))
                    }
                  />
                </label>
                <label className="cookie-setting">
                  <span>
                    <strong>Marketing</strong>
                    Supports relevant content, campaign measurement, and mailer
                    improvements where allowed.
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.marketing}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        marketing: e.target.checked,
                      }))
                    }
                  />
                </label>
              </div>
            )}
          </div>
          <div className="cookie-banner-actions">
            <button
              type="button"
              className="cookie-btn cookie-btn-reject"
              onClick={() =>
                settingsOpen ? handleSaveSettings() : setSettingsOpen(true)
              }
            >
              {settingsOpen ? "Save settings" : "Cookie settings"}
            </button>
            <button
              type="button"
              className="cookie-btn cookie-btn-accept"
              onClick={handleAccept}
            >
              Accept & Continue
            </button>
          </div>
        </div>
      </div>
      {legalDoc && (
        <div
          className="cookie-legal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            legalDoc === "privacy" ? "Privacy Policy" : "Terms of Use"
          }
        >
          <div
            className="cookie-legal-backdrop"
            onClick={() => setLegalDoc(null)}
            aria-hidden="true"
          />
          <div className="cookie-legal-panel">
            <button
              type="button"
              className="cookie-legal-close"
              onClick={() => setLegalDoc(null)}
              aria-label="Close"
            >
              ×
            </button>
            <iframe
              src={
                legalDoc === "privacy"
                  ? "/legal/privacy-policy?embed=1"
                  : "/legal/terms-of-use?embed=1"
              }
              title={legalDoc === "privacy" ? "Privacy Policy" : "Terms of Use"}
              className="cookie-legal-iframe"
            />
          </div>
        </div>
      )}
    </>
  );
}
