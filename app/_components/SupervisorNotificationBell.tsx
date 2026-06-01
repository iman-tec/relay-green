"use client";

/*
 * Supervisor notification bell — sits just before the On/Off-Duty toggle in the
 * /supervise header. Reads the caller's own rows from public.notifications
 * (RLS scopes everything to user_id = auth.uid()), so it's self-contained and
 * talks straight to Supabase — no API route.
 *
 *   - Red dot on the bell whenever there's ≥1 unread (read_at IS NULL).
 *   - Dropdown lists the 50 most recent, newest first.
 *   - Clicking an unread row marks it read (UPDATE own).
 *   - "Clear all" deletes every row (DELETE own policy).
 *   - Realtime keeps it live; tab-focus refetch covers blocked websockets.
 *
 * Primarily driven by supervisor_appointment_booked / _cancelled events from
 * the scheduling RPCs, but renders any notification addressed to the user.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Item = {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

export function SupervisorNotificationBell() {
  const [sb] = useState(() => createClient());
  const [items, setItems] = useState<Item[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tick, setTick] = useState(0); // bump to re-fetch

  const unread = items.filter((n) => !n.readAt).length;

  // Inline load (setState lives in the effect → lint-clean). Re-runs on `tick`;
  // realtime, tab-focus and the optimistic handlers all just bump it.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      setUserId(u.user.id);
      const { data } = await sb
        .from("notifications")
        .select("id, title, body, read_at, created_at")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!alive) return;
      setItems(
        (
          (data ?? []) as Array<{
            id: string;
            title: string;
            body: string | null;
            read_at: string | null;
            created_at: string;
          }>
        ).map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          readAt: r.read_at,
          createdAt: r.created_at,
        }))
      );
    };
    void load();
    return () => {
      alive = false;
    };
  }, [sb, tick]);

  useEffect(() => {
    if (!userId) return;
    const ch = sb
      .channel("relay-supervisor-notif-bell")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => setTick((t) => t + 1)
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, userId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Close on outside-click + ESC.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
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

  const markOne = useCallback(
    async (id: string) => {
      setItems((arr) =>
        arr.map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n
        )
      );
      const { error } = await sb
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) setTick((t) => t + 1);
    },
    [sb]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setItems((arr) =>
      arr.map((n) =>
        n.readAt ? n : { ...n, readAt: new Date().toISOString() }
      )
    );
    const { error } = await sb
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) setTick((t) => t + 1);
  }, [sb, userId]);

  const clearAll = useCallback(async () => {
    if (!userId) return;
    setItems([]);
    const { error } = await sb
      .from("notifications")
      .delete()
      .eq("user_id", userId);
    if (error) setTick((t) => t + 1);
  }, [sb, userId]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={
          unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
        }
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-raised)]"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        <Bell className="size-3.5" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2"
            style={{
              background: "var(--accent-red, #d4453e)",
              boxShadow: "0 0 0 2px var(--surface)",
            }}
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              Notifications
              {unread > 0 && (
                <span
                  className="ml-1.5 text-xs font-normal"
                  style={{ color: "var(--text-muted)" }}
                >
                  · {unread} unread
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="inline-flex items-center gap-1 text-xs transition-colors hover:underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  <CheckCheck size={12} /> Mark read
                </button>
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 text-xs transition-colors hover:underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Trash2 size={12} /> Clear all
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell
                  className="mx-auto mb-2 size-5"
                  style={{ color: "var(--text-faint)" }}
                />
                <div
                  className="text-sm font-medium"
                  style={{ color: "var(--text)" }}
                >
                  You&apos;re all caught up
                </div>
                <div
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  No notifications.
                </div>
              </div>
            ) : (
              <ul>
                {items.map((n) => (
                  <li
                    key={n.id}
                    className="cursor-pointer border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => {
                      if (!n.readAt) void markOne(n.id);
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full"
                        style={{
                          background: n.readAt
                            ? "transparent"
                            : "var(--primary)",
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-sm"
                          style={{
                            color: "var(--text)",
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
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
