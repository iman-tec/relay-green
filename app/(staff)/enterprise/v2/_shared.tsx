"use client";

/*
 * Shared helpers for the Enterprise v2 tabs: a tiny fetch hook with
 * loading/error states, money/number formatting, and a panel scaffold
 * (scroll container + section header) so every tab is responsive + themed
 * consistently against the token layer.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { EmptyState } from "@/app/_components/ui";

export function useApiData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!url) return;
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Request failed (${r.status})`);
        }
        return (await r.json()) as T;
      })
      .then((j) => setData(j))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}

export function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IE").format(n);
}

/** Stat card — icon + big number + caption. Matches the dashboard pattern. */
export function StatCard({
  icon, value, label, hint,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border p-4 sm:p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex size-9 items-center justify-center rounded-xl"
          style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}
        >
          {icon}
        </span>
      </div>
      <div
        className="font-serif text-2xl font-medium tabular-nums sm:text-3xl"
        style={{ color: "var(--text)" }}
      >
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
        {hint ? <span style={{ color: "var(--text-faint)" }}> · {hint}</span> : null}
      </div>
    </div>
  );
}

/** Scroll-safe tab body — fits the viewport, scrolls long content. */
export function TabBody({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-20 text-sm"
      style={{ color: "var(--text-muted)" }}
    >
      <Loader2 size={18} className="animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle size={20} />}
      title="Couldn't load this"
      body={message}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-raised)]"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Try again
          </button>
        ) : undefined
      }
    />
  );
}
