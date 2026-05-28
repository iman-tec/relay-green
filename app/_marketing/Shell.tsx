/*
 * Shared marketing-surface shell: mk-root scope, sticky Nav, Footer, and
 * the Try-Relay modal context provider that lets every "Try Relay" button
 * across the page open the same modal. Used by every marketing route.
 */

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { GEO_COOKIE, USER_COOKIE } from "@/lib/relay/theme";
import "./marketing.css";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { TryRelayProvider, TryRelayModal } from "./TryRelayProvider";

export async function Shell({
  children,
  bare = false,
}: {
  children: ReactNode;
  /**
   * When true, render the content WITHOUT the Nav, Footer, or
   * TryRelayProvider — keeps only the `.mk-root` scope so marketing.css
   * styles still resolve. Used by the legal pages when they're embedded
   * inside the cookie-consent preview iframe (via `?embed=1`) so the
   * user cannot navigate into the rest of the site before accepting
   * cookies.
   */
  bare?: boolean;
}) {
  // Server-side theme resolution mirrors RootLayout so the .mk-root div
  // paints with the correct data-theme on the very first frame. The CSS
  // selectors in marketing.css (`.mk-root[data-theme="..."]`) match this
  // attribute directly, so no client-side flash before ThemeSwitcher's
  // effect runs. Priority: user choice > geo > Sun (no attribute).
  const cookieStore = await cookies();
  const userTheme = cookieStore.get(USER_COOKIE)?.value;
  const geoTheme = cookieStore.get(GEO_COOKIE)?.value;
  const initialTheme = userTheme || geoTheme || "cream";
  const themeAttr = initialTheme !== "cream" ? initialTheme : undefined;

  if (bare) {
    return (
      <div className="mk-root" data-theme={themeAttr}>
        <main>{children}</main>
      </div>
    );
  }
  return (
    <TryRelayProvider>
      <div className="mk-root" id="top" data-theme={themeAttr}>
        <Nav />
        <main>{children}</main>
        <Footer />
        {/* Modal must render INSIDE .mk-root so it inherits the
            theme cascade (data-theme attribute). */}
        <TryRelayModal />
      </div>
    </TryRelayProvider>
  );
}
