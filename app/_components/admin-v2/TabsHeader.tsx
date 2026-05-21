"use client";

/*
 * Page-level top bar used by /admin/v2. Brand on the left, tab strip on
 * the right. Active tab gets a coral underline; the active key is
 * reflected in the URL via ?tab=… so reloads / deep-links work.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Wordmark } from "@/app/_components/Wordmark";

export type Tab<T extends string = string> = {
  key:   T;
  label: string;
};

export function TabsHeader<T extends string>({
  tabs,
  active,
  onChange,
  rightSlot,
  subtitle = "Superadmin Panel",
}: {
  tabs:       readonly Tab<T>[];
  active:     T;
  onChange:   (next: T) => void;
  /** Optional trailing element rendered after the tabs (profile chip, etc.). */
  rightSlot?: React.ReactNode;
  /** Caption shown next to the wordmark. Defaults to "Superadmin Panel". */
  subtitle?:  string;
}) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (params.get("tab") !== active) {
      params.set("tab", active);
      router.replace(`${pathname}?${params}`);
    }
  }, [active, pathname, router, searchParams]);

  return (
    <header
      className="flex shrink-0 items-center justify-between border-b px-5"
      style={{
        borderColor: "var(--border)",
        background:  "var(--surface)",
        height:      56,
      }}
    >
      <div className="flex items-center gap-2.5">
        <Wordmark size="md" />
        <span
          className="hidden text-xs sm:inline"
          style={{ color: "var(--text-muted)" }}
        >
          · {subtitle}
        </span>
      </div>

      <nav className="flex items-center gap-1">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className="relative px-3.5 py-2 text-sm font-medium transition-colors"
              style={{
                color: isActive ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {t.label}
              {isActive && (
                <span
                  className="absolute right-2.5 -bottom-px left-2.5 h-0.5 rounded-t"
                  style={{ background: "var(--primary)" }}
                />
              )}
            </button>
          );
        })}
        {rightSlot && <div className="ml-2">{rightSlot}</div>}
      </nav>
    </header>
  );
}
