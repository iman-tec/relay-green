"use client";

/*
 * Customer notification bell (room top-right). Derives a live notification feed
 * from the customer's own data + realtime subscriptions:
 *   1) Scheduled calls    (engineer_bookings, upcoming booked)
 *   2) Cancelled calls    (engineer_bookings, status=cancelled — timestamped
 *                          by cancelled_at, migration 20260604150000)
 *   3) Appointments       (supervisor_bookings, upcoming booked)
 *   4) Cancelled appts    (supervisor_bookings, status=cancelled)
 *   5) Bid changes        (project_quote_requests — bid ready / accepted / declined)
 *   6) Cancelled sessions (guest_calls — cancelled / abandoned)
 *
 * Unread = items newer than a per-user "last seen" timestamp in localStorage;
 * opening the panel marks everything seen. No backend table needed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarClock, Phone, FileText, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type NotifKind = "call" | "appointment" | "bid" | "cancel";

type Notif = {
  id: string;
  kind: NotifKind;
  ts: number; // epoch ms — sorts + drives unread
  title: string;
  detail: string;
};

const KIND_ICON: Record<NotifKind, typeof Bell> = {
  call: Phone,
  appointment: CalendarClock,
  bid: FileText,
  cancel: XCircle,
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const fmtAgo = (ms: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export function NotificationBell({
  customerUserId,
}: {
  customerUserId: string | null;
}) {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  // "Clear" hides everything at-or-before this instant; newer items still show.
  const [clearedBefore, setClearedBefore] = useState(0);
  // Advances slowly so the 12h auto-expiry takes effect without an event.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const seenKey = customerUserId ? `relay:notif-seen:${customerUserId}` : null;
  const clearedKey = customerUserId
    ? `relay:notif-cleared:${customerUserId}`
    : null;

  // Restore the last-seen + cleared markers.
  useEffect(() => {
    try {
      if (seenKey) {
        const v = Number(window.localStorage.getItem(seenKey));
        if (Number.isFinite(v)) setLastSeen(v);
      }
      if (clearedKey) {
        const c = Number(window.localStorage.getItem(clearedKey));
        if (Number.isFinite(c)) setClearedBefore(c);
      }
    } catch {
      /* ignore */
    }
  }, [seenKey, clearedKey]);

  // Re-filter every few minutes so 12h-old items drop off on their own.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!customerUserId) return;
    const sb = createClient();
    const nowIso = new Date().toISOString();
    const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
    const [callRes, callCancelRes, apptRes, apptCancelRes, bidRes, sessRes] =
      await Promise.all([
        sb
          .from("engineer_bookings")
          .select("id, project_id, slot_start, created_at")
          .eq("customer_user_id", customerUserId)
          .eq("status", "booked")
          .gte("slot_end", nowIso)
          .order("created_at", { ascending: false })
          .limit(20),
        // Cancelled scheduled calls — timestamped by cancelled_at (stamped by
        // the eb_stamp_cancelled trigger) so they surface as FRESH unread
        // items at cancel time, not back-dated to when they were booked.
        sb
          .from("engineer_bookings")
          .select("id, project_id, slot_start, created_at, cancelled_at")
          .eq("customer_user_id", customerUserId)
          .eq("status", "cancelled")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(20),
        sb
          .from("supervisor_bookings")
          .select("id, project_name, slot_start, created_at")
          .eq("customer_user_id", customerUserId)
          .eq("status", "booked")
          .gte("slot_end", nowIso)
          .order("created_at", { ascending: false })
          .limit(20),
        // Cancelled appointments — same cancelled_at treatment.
        sb
          .from("supervisor_bookings")
          .select("id, project_name, slot_start, created_at, cancelled_at")
          .eq("customer_user_id", customerUserId)
          .eq("status", "cancelled")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(20),
        sb
          .from("project_quote_requests")
          .select(
            "id, project_id, status, responded_at, committed_at, created_at"
          )
          .eq("customer_user_id", customerUserId)
          .in("status", ["quoted", "committed", "declined"])
          .order("created_at", { ascending: false })
          .limit(20),
        sb
          .from("guest_calls")
          .select("id, project_id, status, ended_at, created_at")
          .eq("customer_user_id", customerUserId)
          .in("status", ["cancelled", "abandoned"])
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    // Resolve project names.
    const pids = new Set<string>();
    for (const r of (callRes.data ?? []) as { project_id: string | null }[])
      if (r.project_id) pids.add(r.project_id);
    for (const r of (callCancelRes.data ?? []) as {
      project_id: string | null;
    }[])
      if (r.project_id) pids.add(r.project_id);
    for (const r of (bidRes.data ?? []) as { project_id: string | null }[])
      if (r.project_id) pids.add(r.project_id);
    for (const r of (sessRes.data ?? []) as { project_id: string | null }[])
      if (r.project_id) pids.add(r.project_id);
    const nameById = new Map<string, string>();
    if (pids.size) {
      const { data } = await sb
        .from("projects")
        .select("id, name")
        .in("id", [...pids]);
      for (const p of (data ?? []) as { id: string; name: string | null }[])
        if (p.name) nameById.set(p.id, p.name);
    }
    const proj = (id: string | null) => (id && nameById.get(id)) || "a project";

    const out: Notif[] = [];
    for (const r of (callRes.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      slot_start: string;
      created_at: string;
    }>)
      out.push({
        id: `call-${r.id}`,
        kind: "call",
        ts: new Date(r.created_at).getTime(),
        title: "Scheduled call booked",
        detail: `${proj(r.project_id)} · ${fmtWhen(r.slot_start)}`,
      });
    for (const r of (callCancelRes.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      slot_start: string;
      created_at: string;
      cancelled_at: string | null;
    }>)
      out.push({
        id: `call-cancel-${r.id}`,
        kind: "cancel",
        ts: new Date(r.cancelled_at ?? r.created_at).getTime(),
        title: "Scheduled call cancelled",
        detail: `${proj(r.project_id)} · was ${fmtWhen(r.slot_start)}`,
      });
    for (const r of (apptRes.data ?? []) as Array<{
      id: string;
      project_name: string | null;
      slot_start: string;
      created_at: string;
    }>)
      out.push({
        id: `appt-${r.id}`,
        kind: "appointment",
        ts: new Date(r.created_at).getTime(),
        title: "Appointment booked",
        detail: `${r.project_name ?? "a project"} · ${fmtWhen(r.slot_start)}`,
      });
    for (const r of (apptCancelRes.data ?? []) as Array<{
      id: string;
      project_name: string | null;
      slot_start: string;
      created_at: string;
      cancelled_at: string | null;
    }>)
      out.push({
        id: `appt-cancel-${r.id}`,
        kind: "cancel",
        ts: new Date(r.cancelled_at ?? r.created_at).getTime(),
        title: "Appointment cancelled",
        detail: `${r.project_name ?? "a project"} · was ${fmtWhen(r.slot_start)}`,
      });
    for (const r of (bidRes.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      status: string;
      responded_at: string | null;
      committed_at: string | null;
      created_at: string;
    }>) {
      const title =
        r.status === "quoted"
          ? "New bid ready to review"
          : r.status === "committed"
            ? "Contract is now active"
            : "Bid declined";
      const tsIso =
        (r.status === "committed" ? r.committed_at : r.responded_at) ??
        r.created_at;
      out.push({
        id: `bid-${r.id}`,
        kind: "bid",
        ts: new Date(tsIso).getTime(),
        title,
        detail: proj(r.project_id),
      });
    }
    for (const r of (sessRes.data ?? []) as Array<{
      id: string;
      project_id: string | null;
      ended_at: string | null;
      created_at: string;
    }>)
      out.push({
        id: `sess-${r.id}`,
        kind: "cancel",
        ts: new Date(r.ended_at ?? r.created_at).getTime(),
        title: "Session cancelled",
        detail: proj(r.project_id),
      });

    out.sort((a, b) => b.ts - a.ts);
    setItems(out.slice(0, 20));
  }, [customerUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: any change in the four sources refreshes the feed.
  useEffect(() => {
    if (!customerUserId) return;
    const sb = createClient();
    const ch = sb.channel(`notif-${customerUserId}-${crypto.randomUUID()}`);
    for (const table of [
      "engineer_bookings",
      "supervisor_bookings",
      "project_quote_requests",
      "guest_calls",
    ])
      ch.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `customer_user_id=eq.${customerUserId}`,
        },
        () => void load()
      );
    ch.subscribe();
    const onChanged = () => void load();
    window.addEventListener("relay:scheduled-changed", onChanged);
    window.addEventListener("relay:appointments-changed", onChanged);
    return () => {
      void sb.removeChannel(ch);
      window.removeEventListener("relay:scheduled-changed", onChanged);
      window.removeEventListener("relay:appointments-changed", onChanged);
    };
  }, [customerUserId, load]);

  // Close on outside-click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Drop items the customer cleared, and anything older than 12 hours.
  const visibleItems = useMemo(() => {
    const cutoff = Math.max(clearedBefore, nowTick - 12 * 60 * 60_000);
    return items.filter((i) => i.ts >= cutoff);
  }, [items, clearedBefore, nowTick]);

  // ── Glassmorphism pop toaster (top-center of the home/center panel) ─────
  // Every kind — bids and contracts included — pops on live arrival and
  // auto-dismisses to the bell after 5s. The bell keeps the full history.
  const [toasts, setToasts] = useState<Notif[]>([]);
  const toastBaselineRef = useRef<number | null>(null);
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (visibleItems.length === 0) return;
    const newest = visibleItems[0].ts;
    if (toastBaselineRef.current === null) {
      toastBaselineRef.current = newest;
      return;
    }
    const baseline = toastBaselineRef.current;
    const fresh = visibleItems.filter((i) => i.ts > baseline);
    if (visibleItems[0].ts > baseline) toastBaselineRef.current = newest;
    if (fresh.length === 0) return;
    if (open) return; // panel already open — the list itself shows them
    const popped = fresh.slice(0, 3);
    setToasts((prev) => [...popped, ...prev].slice(0, 3));
    const ids = popped.map((f) => f.id);
    toastTimersRef.current.push(
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => !ids.includes(t.id)));
      }, 5000)
    );
  }, [visibleItems, open]);
  useEffect(
    () => () => {
      for (const t of toastTimersRef.current) clearTimeout(t);
    },
    []
  );

  const unread = useMemo(
    () => visibleItems.filter((i) => i.ts > lastSeen).length,
    [visibleItems, lastSeen]
  );

  const clearAll = () => {
    const ts = Date.now();
    setClearedBefore(ts);
    if (clearedKey) {
      try {
        window.localStorage.setItem(clearedKey, String(ts));
      } catch {
        /* ignore */
      }
    }
  };

  const openPanel = () => {
    setOpen((v) => {
      const next = !v;
      if (next && seenKey) {
        // Mark everything seen the moment the panel opens.
        const newest = visibleItems.length ? visibleItems[0].ts : Date.now();
        setLastSeen(newest);
        try {
          window.localStorage.setItem(seenKey, String(newest));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={openPanel}
        aria-label={`Notifications${unread ? ` (${unread} new)` : ""}`}
        className="relative flex size-9 items-center justify-center rounded-full transition-colors hover:bg-black/5 max-lg:size-11 dark:hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
            style={{ background: "var(--risk)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 z-[var(--z-modal)] mt-2 flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border shadow-2xl"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <div
            className="flex items-center gap-2 border-b px-4 py-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <span
              className="flex-1 text-[13px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              Notifications
            </span>
            {visibleItems.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] font-medium transition-colors hover:opacity-70"
                style={{ color: "var(--primary-hover)" }}
              >
                Clear
              </button>
            )}
          </div>
          {/* Latest 6 visible; the rest scroll (~56px per row). */}
          <div
            className="hide-scrollbar overflow-y-auto"
            style={{ maxHeight: "21rem" }}
          >
            {visibleItems.length === 0 ? (
              <p
                className="px-4 py-8 text-center text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                You&apos;re all caught up.
              </p>
            ) : (
              <ul>
                {visibleItems.map((n) => {
                  const Icon = KIND_ICON[n.kind];
                  return (
                    <li
                      key={n.id}
                      className="flex items-start gap-2.5 border-t px-4 py-2.5 first:border-t-0"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span
                        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background:
                            n.kind === "cancel"
                              ? "color-mix(in srgb, var(--risk) 14%, transparent)"
                              : "var(--primary-soft)",
                          color:
                            n.kind === "cancel"
                              ? "var(--risk)"
                              : "var(--primary)",
                        }}
                      >
                        <Icon size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[12.5px] font-medium"
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
                      <span
                        className="shrink-0 text-[10.5px]"
                        style={{ color: "var(--text-faint)" }}
                      >
                        {fmtAgo(n.ts)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Glassmorphism toasts — frosted, translucent cards dropping in at
          the TOP-CENTER of the main panel (dynamic-island style) so they
          can't be missed; the bell keeps the full history for review.
          Click anywhere on a card to open the panel; × dismisses it.
          <lg the stack starts BELOW the header strip (hamburger + pills +
          bell live in the top ~56px band — at top-6 the toast covered
          them on phones); ≥lg it floats at the original top-center. */}
      {toasts.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 top-6 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {toasts.map((n) => {
            const Icon = KIND_ICON[n.kind];
            return (
              <div
                key={`toast-${n.id}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setToasts([]);
                  if (!open) openPanel();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setToasts([]);
                    if (!open) openPanel();
                  }
                }}
                className="pointer-events-auto flex w-96 max-w-full cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl"
                style={{
                  animation: "relay-toast-in 220ms ease-out",
                  background:
                    "color-mix(in srgb, var(--surface) 62%, transparent)",
                  borderColor:
                    "color-mix(in srgb, var(--text) 14%, transparent)",
                  backdropFilter: "blur(16px) saturate(1.5)",
                  WebkitBackdropFilter: "blur(16px) saturate(1.5)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
                }}
              >
                <span
                  className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background:
                      n.kind === "cancel"
                        ? "color-mix(in srgb, var(--risk) 14%, transparent)"
                        : "var(--primary-soft)",
                    color:
                      n.kind === "cancel" ? "var(--risk)" : "var(--primary)",
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
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Dismiss notification"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToasts((prev) => prev.filter((t) => t.id !== n.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setToasts((prev) => prev.filter((t) => t.id !== n.id));
                    }
                  }}
                  className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                  style={{ color: "var(--text-muted)" }}
                >
                  <XCircle size={13} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
