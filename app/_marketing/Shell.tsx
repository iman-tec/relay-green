/*
 * Shared marketing-surface shell: mk-root scope, sticky Nav, Footer, and
 * the Try-Relay modal context provider that lets every "Try Relay" button
 * across the page open the same modal. Used by every marketing route.
 */

import type { ReactNode } from "react";
import "./marketing.css";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { TryRelayProvider } from "./TryRelayProvider";

export function Shell({
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
  if (bare) {
    return (
      <div className="mk-root">
        <main>{children}</main>
      </div>
    );
  }
  return (
    <TryRelayProvider>
      <div className="mk-root" id="top">
        <Nav />
        <main>{children}</main>
        <Footer />
      </div>
    </TryRelayProvider>
  );
}
