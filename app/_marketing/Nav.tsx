"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TryRelayButton } from "./TryRelayButton";

type NavItem =
  | { label: string; href: string; route: string }
  | { label: string; href?: undefined };

const NAV_ITEMS: NavItem[] = [
  { label: "How it works", href: "/product", route: "/product" },
  {
    label: "Enterprise",
    href: "/for-enterprise",
    route: "/for-enterprise",
  },
  { label: "Resources", href: "/resources/blog", route: "/resources" },
  { label: "Company", href: "/company/about", route: "/company" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
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
        <Link
          href="/"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <span className="r-logo">
            <span className="r-logo-word">RELAY</span>
            <span
              className="r-logo-dot"
              style={{ width: 16, height: 16, background: "var(--green)" }}
            ></span>
          </span>
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
          <Link href="/login" className="r-nav-link">
            Sign in
          </Link>
          <TryRelayButton />
        </div>
      </div>
    </nav>
  );
}
