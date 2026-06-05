"use client";

/*
 * Engineer pop-up alerts — top-center glassmorphic toasts that mirror the
 * customer's NotificationBell toast style (app/_components/NotificationBell.tsx).
 * Mounted once in StaffShell for engineers, so a toast shows on every staff
 * page (Dashboard / Inbox / Quotation / Calendar) but NOT inside a live call —
 * the session route (/staff/session/[id]) lives outside the (staff) layout, so
 * StaffShell (and this component) never mounts there.
 *
 * Driven off the SAME public.notifications rows the dashboard bell reads — that
 * feed is owner-scoped (user_id = auth.uid()), so its realtime delivers
 * reliably (unlike a raw project_quote_requests subscription, whose has_role()
 * RLS doesn't deliver over postgres_changes). Two kinds surface as toasts:
 *   - call_scheduled / call_rescheduled → TRANSIENT (auto-dismiss), like the
 *     customer toast.
 *   - bid_request → STICKY: stays until the engineer presses × (or "Create
 *     bid"). It survives client navigation (shared shell) and, on a full
 *     reload, recent un-dismissed bid requests are re-surfaced. Dismissals are
 *     remembered per-notification in localStorage, independent of the bell's
 *     read/clear state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, FileText, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type ToastKind = "call" | "bid";
type Toast = {
  id: string; // `notif-<notificationId>` — unique per notification
  rid?: string; // bid request id (for the "Create bid" deep link)
  kind: ToastKind;
  title: string;
  detail: string;
  sticky: boolean;
};

type NotifRow = {
  id: string;
  request_id: string | null;
  kind: string;
  title: string;
  body: string | null;
};

const DISMISSED_KEY = "relay:eng-bid-dismissed";
const TRANSIENT_MS = 9000;
const BID_LOOKBACK_MS = 24 * 60 * 60 * 1000; // re-surface bids from last 24h

// Map a notification row to a toast (or null for kinds we don't pop).
function toToast(n: NotifRow): Toast | null {
  if (n.kind === "bid_request") {
    return {
      id: `notif-${n.id}`,
      rid: n.request_id ?? undefined,
      kind: "bid",
      title: n.title,
      detail: n.body ?? "",
      sticky: true,
    };
  }
  if (n.kind === "call_scheduled" || n.kind === "call_rescheduled") {
    return {
      id: `notif-${n.id}`,
      kind: "call",
      title: n.title,
      detail: n.body ?? "",
      sticky: false,
    };
  }
  return null;
}

export function EngineerAlerts() {
  const router = useRouter();
  const sbRef = useRef(createClient());
  const [me, setMe] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Toast ids the engineer has dismissed — kept in a ref + localStorage so a
  // reload doesn't resurrect a closed bid toast (independent of the bell).
  const dismissedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Restore the dismissed set + resolve the signed-in engineer.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DISMISSED_KEY);
      if (raw) dismissedRef.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore malformed cache */
    }
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data } = await sb.auth.getUser();
      if (alive) setMe(data.user?.id ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persistDismissed = useCallback(() => {
    try {
      window.localStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify([...dismissedRef.current])
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, []);

  const addToast = useCallback((t: Toast) => {
    setToasts((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]));
    if (!t.sticky) {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
        timersRef.current.delete(t.id);
      }, TRANSIENT_MS);
      timersRef.current.set(t.id, timer);
    }
  }, []);

  const dismiss = useCallback(
    (t: Toast) => {
      dismissedRef.current.add(t.id);
      persistDismissed();
      const timer = timersRef.current.get(t.id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(t.id);
      }
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    },
    [persistDismissed]
  );

  // "Create bid" — jump to the Quotation queue with this request pre-expanded
  // in the Needs-bid section. Dismisses the toast (it persists in the bell);
  // the bid stays in the queue until the engineer submits it.
  const createBid = useCallback(
    (t: Toast) => {
      dismiss(t);
      if (t.rid) router.push(`/quotations?bid=${t.rid}`);
    },
    [dismiss, router]
  );

  // On (re)load, re-surface recent un-dismissed bid requests so the bid toast
  // stays "constant" across reloads.
  useEffect(() => {
    if (!me) return;
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const sinceIso = new Date(Date.now() - BID_LOOKBACK_MS).toISOString();
      const { data } = await sb
        .from("notifications")
        .select("id, request_id, kind, title, body, created_at")
        .eq("user_id", me)
        .eq("kind", "bid_request")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(6);
      if (!alive || !data) return;
      for (const row of data as NotifRow[]) {
        const t = toToast(row);
        if (t && !dismissedRef.current.has(t.id)) addToast(t);
      }
    })();
    return () => {
      alive = false;
    };
  }, [me, addToast]);

  // Realtime: pop a toast for each new notification of ours.
  useEffect(() => {
    if (!me) return;
    const sb = sbRef.current;
    const suffix =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}`;
    const ch = sb
      .channel(`engineer-alerts-${me}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${me}`,
        },
        (payload) => {
          const t = toToast(payload.new as NotifRow);
          if (!t || dismissedRef.current.has(t.id)) return;
          addToast(t);
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [me, addToast]);

  // Clear any pending transient timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  if (!toasts.length) return null;

  // Glassmorphic top-center stack — identical chrome to the customer's
  // NotificationBell toast so the two surfaces feel like one product.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4">
      {toasts.map((n) => {
        const Icon = n.kind === "bid" ? FileText : Phone;
        return (
          <div
            key={n.id}
            className="pointer-events-auto flex w-96 max-w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl"
            style={{
              animation: "relay-toast-in 220ms ease-out",
              background: "color-mix(in srgb, var(--surface) 62%, transparent)",
              borderColor: "color-mix(in srgb, var(--text) 14%, transparent)",
              backdropFilter: "blur(16px) saturate(1.5)",
              WebkitBackdropFilter: "blur(16px) saturate(1.5)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            }}
          >
            <span
              className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "var(--primary-soft)",
                color: "var(--primary)",
              }}
            >
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="text-[12.5px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                {n.title}
              </div>
              <div
                className="truncate text-[11.5px]"
                style={{ color: "var(--text-muted)" }}
              >
                {n.detail}
              </div>
            </div>
            {/* Action — INLINE on the same row, between the text and the
                dismiss ×, vertically centred. */}
            {n.kind === "bid" && (
              <button
                type="button"
                onClick={() => createBid(n)}
                className="inline-flex shrink-0 items-center gap-1.5 self-center rounded-full px-3 py-1.5 text-[11px] leading-none font-semibold whitespace-nowrap text-white transition-[filter] hover:brightness-110"
                style={{ backgroundColor: "var(--primary)" }}
              >
                <FileText size={11} /> Create bid
              </button>
            )}
            {/* Dismiss — ghost circle, vertically centred with the row. */}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(n)}
              className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center self-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
