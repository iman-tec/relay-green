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

export function Shell({ children }: { children: ReactNode }) {
  return (
    <TryRelayProvider>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="mk-root" id="top">
        <Nav />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </div>
    </TryRelayProvider>
  );
}
