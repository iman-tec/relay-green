"use client";

/*
 * Footer link that re-opens the cookie consent banner.
 *
 * Required for GDPR (Art. 7(3)) and DPDP / CCPA: a user must be able to
 * withdraw consent as easily as they gave it. CookieConsent listens for
 * the same-tab custom event "relay:cookies-reopen" and re-mounts with
 * the user's current preferences pre-selected.
 *
 * The link is styled to match the other footer-bottom links (Privacy,
 * Terms of Use), so the cluster reads as one bottom rule.
 */
export function ManageCookiesLink() {
  function reopen() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("relay:cookies-reopen"));
  }

  return (
    <button
      type="button"
      onClick={reopen}
      style={{
        background: "transparent",
        border: 0,
        padding: 0,
        font: "inherit",
        color: "var(--footer-link)",
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      Manage cookie preferences
    </button>
  );
}
