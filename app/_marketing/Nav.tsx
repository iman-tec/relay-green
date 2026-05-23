"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TryRelayButton } from "./TryRelayButton";
import { RelayLogo } from "./RelayLogo";
import { MobileNavDrawer } from "./MobileNavDrawer";

type NavItem =
  | {
      label: string;
      href: string;
      route: string;
    }
  | { label: string; href?: undefined };

const NAV_ITEMS: NavItem[] = [
  { label: "How it Works", href: "/product", route: "/product" },
  {
    label: "For Enterprises",
    href: "/for-enterprise",
    route: "/for-enterprise",
  },
  {
    label: "About RELAY",
    href: "/",
    route: "/",
  },
];

const DRAWER_ITEMS = NAV_ITEMS.filter(
  (
    item
  ): item is {
    label: string;
    href: string;
    route: string;
  } => !!item.href
);

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={"r-nav" + (scrolled ? " scrolled" : "")}>
      <div className="r-nav-inner">
        {/* Hamburger renders first in source order so on mobile the
            flex layout pins it to the left, the brand absolute-centers,
            and the .r-nav-cta cluster (Try Relay) sits on the right.
            Above 980 px this button hides and the original
            brand-left / links-middle / cta-right desktop nav returns. */}
        <button
          type="button"
          className="r-nav-burger"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="r-mobile-drawer"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Link
          href="/"
          className="r-nav-brand"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          {/* Canonical RelayLogo component, sans, uppercase, animated
              green dot. The single source of truth for the brand mark. */}
          <RelayLogo size={22} color="var(--ink)" />
        </Link>
        <div className="r-nav-links">
          {NAV_ITEMS.map((item) => {
            if (!item.href) {
              return (
                <button
                  key={item.label}
                  type="button"
                  className="r-nav-link"
                  aria-disabled="true"
                >
                  {item.label}
                </button>
              );
            }
            const active =
              pathname === item.href ||
              (item.route !== item.href && pathname.startsWith(item.route));

            return (
              <Link
                key={item.label}
                href={item.href}
                className={"r-nav-link" + (active ? " active" : "")}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="r-nav-cta">
          <button type="button" className="r-nav-link">
            Sign in
          </button>
          <TryRelayButton />
        </div>
      </div>
      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={DRAWER_ITEMS}
      />
    </nav>
  );
}
