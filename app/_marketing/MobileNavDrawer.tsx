"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { TryRelayButton } from "./TryRelayButton";

type NavItem = {
  label: string;
  href: string;
  route: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
};

export function MobileNavDrawer({ open, onClose, items }: Props) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="r-mobile-drawer"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
    >
      <div
        className="r-mobile-drawer-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="r-mobile-drawer-head">
          <span aria-hidden="true" />
          <button
            type="button"
            className="r-mobile-drawer-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="r-mobile-drawer-links" aria-label="Primary">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.route !== item.href && pathname.startsWith(item.route));

            return (
              <Link
                key={item.label}
                href={item.href}
                className={"r-mobile-drawer-link" + (active ? " active" : "")}
                onClick={onClose}
              >
                <span>{item.label}</span>
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            );
          })}
          <Link
            href="/login"
            className="r-mobile-drawer-link"
            onClick={onClose}
          >
            <span>Sign in</span>
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </nav>

        <div className="r-mobile-drawer-foot">
          <TryRelayButton />
        </div>
      </div>
    </div>
  );
}
