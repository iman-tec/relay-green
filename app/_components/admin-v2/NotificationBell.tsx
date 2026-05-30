"use client";

/*
 * Inbox bell + dropdown for the Channel Partner top bar. Reads from
 * /api/reseller/notifications, subscribes to public.notifications via
 * Realtime for live pushes, and falls back to a tab-focus refetch when
 * the websocket is blocked.
 *
 *   - Unread count badge on the bell.
 *   - Dropdown shows the 50 most recent items, latest first.
 *   - Click an unread row → PATCH it as read (optimistic).
 *   - "Mark all read" button when unread > 0.
 *   - ESC + outside-click close the dropdown.
 *
 * Self-contained; safe to mount anywhere a reseller-scoped user is signed
 * in. RLS on `notifications` keeps cross-user reads impossible at the DB.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type NotificationItem = {
  id:        string;
  kind:      string;
  title:     string;
  body:      string | null;
  readAt:    string | null;
  createdAt: string;
};

type Payload = { items: NotificationItem[]; unread: number };

/**
 * Notification inbox bell. `endpoint` is the inbox base path:
 *   GET  <endpoint>        → { items, unread }
 *   POST <endpoint>        → mark all read
 *   PATCH <endpoint>/:id   → mark one read
 * Defaults to the reseller inbox for back-compat. `channelKey` just needs to
 * be unique per mounted bell so two bells don't share a Realtime channel.
 */
export function NotificationBell({
  endpoint = "/api/reseller/notifications",
  channelKey = "reseller",
}: {
  endpoint?: string;
  channelKey?: string;
} = {}) {
  const [data, setData] = useState<Payload>({ items: [], unread: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as Payload;
      setData(json);
    } catch {
      /* network glitch — silent; next event/focus retries */
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void reload(); }, [reload]);

  // Realtime: any insert/update on notifications triggers a re-fetch. RLS
  // ensures we only receive events for our own rows.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`${channelKey}-notifications-bell`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => { void reload(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload, channelKey]);

  // Tab-focus refetch — covers networks that block Realtime websockets.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  // Close on outside click + ESC.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markOne = useCallback(async (id: string) => {
    // Optimistic: flip locally first, then re-fetch on success.
    setData((d) => ({
      items:  d.items.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      unread: Math.max(0, d.unread - 1),
    }));
    try {
      const res = await fetch(`${endpoint}/${id}`, { method: "PATCH" });
      if (!res.ok) await reload(); // server rejected — re-sync from truth.
    } catch {
      await reload();
    }
  }, [reload, endpoint]);

  const markAll = useCallback(async () => {
    setData((d) => ({
      items:  d.items.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
      unread: 0,
    }));
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) await reload();
    } catch {
      await reload();
    }
  }, [reload, endpoint]);

  const { items, unread } = data;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-raised)]"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        <Bell className="size-3.5" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
            style={{
              height:     16,
              background: "var(--primary)",
              color:      "var(--surface)",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Notifications
              {unread > 0 && (
                <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                  · {unread} unread
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1 text-xs transition-colors hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto mb-2 size-5" style={{ color: "var(--text-faint)" }} />
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  You&apos;re all caught up
                </div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  No notifications yet.
                </div>
              </div>
            ) : (
              <ul>
                {items.map((n) => (
                  <li
                    key={n.id}
                    className="cursor-pointer border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => { if (!n.readAt) void markOne(n.id); }}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full"
                        style={{ background: n.readAt ? "transparent" : "var(--primary)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-sm"
                          style={{
                            color:      "var(--text)",
                            fontWeight: n.readAt ? 400 : 500,
                          }}
                        >
                          {n.title}
                        </div>
                        {n.body && (
                          <div
                            className="mt-0.5 line-clamp-2 text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {n.body}
                          </div>
                        )}
                        <div
                          className="mt-1 text-[10px]"
                          style={{ color: "var(--text-faint)" }}
                        >
                          {relativeTime(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
