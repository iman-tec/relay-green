"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import { useRequireEngineerProfile } from "@/lib/relay/useRequireEngineerProfile";
import { EngineerAvailabilityToggle } from "@/app/_components/EngineerAvailabilityToggle";
import { createClient } from "@/lib/supabase/browser";
import {
  Activity,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  CreditCard,
  TrendingUp,
  Loader2,
  PhoneIncoming,
  AlertTriangle,
  X,
} from "lucide-react";
import type { GuestCall } from "@/lib/supabase/types";

// ── Incoming-section row shapes ─────────────────────────────────────────
type IncomingRequest = {
  id: string;
  customerUserId: string;
  projectId: string | null;
  message: string | null;
  createdAt: string;
  customerName: string | null;
  customerEmail: string | null;
  projectName: string | null;
};

type IncomingBooking = {
  id: string;
  slotStart: string;
  slotEnd: string;
  customerUserId: string;
  projectId: string | null;
  notes: string | null;
  customerName: string | null;
  customerEmail: string | null;
  projectName: string | null;
};

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#d4a017";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const CRIT_RED = "#8b1a1a";
const CRIT_RED_SOFT = "rgba(139, 26, 26, 0.18)";

export function DashboardClient() {
  const router = useRouter();
  useRequireEngineerProfile();
  const { myActive, queue, recent, loading, error, takeNext, claim } = useEngineerWorkspace();

  // ── Incoming-for-you: pending connect requests + upcoming bookings ──
  // Surfaced ABOVE the existing queue because a customer who specifically
  // chose YOU (request or scheduled slot) outranks the anonymous queue.
  // Both lists realtime-sync so the engineer doesn't need to refresh.
  const sbRef = useRef(createClient());
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([]);
  const [incomingBookings, setIncomingBookings] = useState<IncomingBooking[]>([]);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Lookup helpers used to enrich the raw rows with customer / project
  // names. Pulled inline rather than via foreign-key embed because the
  // existing schema doesn't have an FK that PostgREST resolves to
  // customer_profiles cleanly.
  const enrichRequest = useCallback(async (row: {
    id: string;
    customer_user_id: string;
    project_id: string | null;
    message: string | null;
    created_at: string;
  }): Promise<IncomingRequest> => {
    const sb = sbRef.current;
    const [custRes, projRes] = await Promise.all([
      sb.from("customer_profiles")
        .select("display_name, email")
        .eq("user_id", row.customer_user_id)
        .maybeSingle(),
      row.project_id
        ? sb.from("projects").select("name").eq("id", row.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
    const proj = (projRes.data ?? null) as { name: string | null } | null;
    return {
      id: row.id,
      customerUserId: row.customer_user_id,
      projectId: row.project_id,
      message: row.message,
      createdAt: row.created_at,
      customerName: cust?.display_name ?? null,
      customerEmail: cust?.email ?? null,
      projectName: proj?.name ?? null,
    };
  }, []);

  const enrichBooking = useCallback(async (row: {
    id: string;
    slot_start: string;
    slot_end: string;
    customer_user_id: string;
    project_id: string | null;
    notes: string | null;
  }): Promise<IncomingBooking> => {
    const sb = sbRef.current;
    const [custRes, projRes] = await Promise.all([
      sb.from("customer_profiles")
        .select("display_name, email")
        .eq("user_id", row.customer_user_id)
        .maybeSingle(),
      row.project_id
        ? sb.from("projects").select("name").eq("id", row.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
    const proj = (projRes.data ?? null) as { name: string | null } | null;
    return {
      id: row.id,
      slotStart: row.slot_start,
      slotEnd: row.slot_end,
      customerUserId: row.customer_user_id,
      projectId: row.project_id,
      notes: row.notes,
      customerName: cust?.display_name ?? null,
      customerEmail: cust?.email ?? null,
      projectName: proj?.name ?? null,
    };
  }, []);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;

    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      if (!alive || !me) return;

      // Pending requests (engineer Busy → customer pinged).
      const reqRes = await sb
        .from("engineer_connect_requests")
        .select("id, customer_user_id, project_id, message, created_at")
        .eq("engineer_user_id", me)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      // Upcoming bookings — fetched-ahead 30 days.
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      const bkRes = await sb
        .from("engineer_bookings")
        .select("id, slot_start, slot_end, customer_user_id, project_id, notes")
        .eq("engineer_user_id", me)
        .eq("status", "booked")
        .gte("slot_end", new Date(Date.now() - 15 * 60_000).toISOString())
        .lt("slot_start", horizon.toISOString())
        .order("slot_start", { ascending: true });

      if (!alive) return;
      const reqRows = (reqRes.data ?? []) as Array<{
        id: string; customer_user_id: string; project_id: string | null;
        message: string | null; created_at: string;
      }>;
      const bkRows = (bkRes.data ?? []) as Array<{
        id: string; slot_start: string; slot_end: string;
        customer_user_id: string; project_id: string | null; notes: string | null;
      }>;
      const [enrichedReq, enrichedBk] = await Promise.all([
        Promise.all(reqRows.map(enrichRequest)),
        Promise.all(bkRows.map(enrichBooking)),
      ]);
      if (!alive) return;
      setIncomingRequests(enrichedReq);
      setIncomingBookings(enrichedBk);

      // Realtime — connect-requests changes for this engineer.
      const reqCh = sb
        .channel(`dash-requests-${me}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_connect_requests",
            filter: `engineer_user_id=eq.${me}`,
          },
          (payload) => {
            const next = payload.new as (typeof reqRows[number] & { status?: string }) | null;
            const old = payload.old as { id?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setIncomingRequests((prev) => prev.filter((r) => r.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "pending") {
              setIncomingRequests((prev) => prev.filter((r) => r.id !== next.id));
              return;
            }
            void enrichRequest(next).then((enriched) => {
              if (!alive) return;
              setIncomingRequests((prev) => {
                const without = prev.filter((r) => r.id !== enriched.id);
                return [enriched, ...without].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                );
              });
            });
          },
        )
        .subscribe();

      // Realtime — bookings changes for this engineer.
      const bkCh = sb
        .channel(`dash-bookings-${me}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_bookings",
            filter: `engineer_user_id=eq.${me}`,
          },
          (payload) => {
            const next = payload.new as (typeof bkRows[number] & { status?: string }) | null;
            const old = payload.old as { id?: string } | null;
            const oldId = old?.id;
            if (!next && oldId) {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== oldId));
              return;
            }
            if (!next) return;
            if (next.status !== "booked") {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== next.id));
              return;
            }
            // Past slots fall out of the list.
            if (new Date(next.slot_end).getTime() < Date.now() - 15 * 60_000) {
              setIncomingBookings((prev) => prev.filter((b) => b.id !== next.id));
              return;
            }
            void enrichBooking(next).then((enriched) => {
              if (!alive) return;
              setIncomingBookings((prev) => {
                const without = prev.filter((b) => b.id !== enriched.id);
                return [...without, enriched].sort(
                  (a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
                );
              });
            });
          },
        )
        .subscribe();

      return () => { sb.removeChannel(reqCh); sb.removeChannel(bkCh); };
    })();

    return () => { alive = false; };
  }, [enrichRequest, enrichBooking]);

  const onAcceptRequest = useCallback(async (req: IncomingRequest) => {
    if (actionBusyId) return;
    setActionBusyId(req.id);
    try {
      const sb = sbRef.current;
      const { error: rpcErr } = await sb.rpc("accept_connect_request", { _id: req.id });
      if (rpcErr) {
        window.alert(`Couldn't accept: ${rpcErr.message}`);
        return;
      }
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
    } finally {
      setActionBusyId(null);
    }
  }, [actionBusyId]);

  const onDeclineRequest = useCallback(async (req: IncomingRequest) => {
    if (actionBusyId) return;
    setActionBusyId(req.id);
    try {
      const sb = sbRef.current;
      const { error: rpcErr } = await sb.rpc("decline_connect_request", { _id: req.id });
      if (rpcErr) {
        window.alert(`Couldn't decline: ${rpcErr.message}`);
        return;
      }
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
    } finally {
      setActionBusyId(null);
    }
  }, [actionBusyId]);

  const onCancelBooking = useCallback(async (b: IncomingBooking) => {
    if (actionBusyId) return;
    if (typeof window !== "undefined" && !window.confirm("Cancel this booking? The customer will be notified.")) return;
    setActionBusyId(b.id);
    try {
      const sb = sbRef.current;
      const { error: rpcErr } = await sb.rpc("cancel_booking", { _id: b.id });
      if (rpcErr) {
        window.alert(`Couldn't cancel: ${rpcErr.message}`);
        return;
      }
      setIncomingBookings((prev) => prev.filter((x) => x.id !== b.id));
    } finally {
      setActionBusyId(null);
    }
  }, [actionBusyId]);

  const hasIncoming = incomingRequests.length > 0 || incomingBookings.length > 0;

  const liveCount = myActive.filter((s) => s.status === "live").length;
  const completedToday = recent.filter((s) => {
    if (s.status !== "ended") return false;
    const d = new Date(s.created_at);
    const today = new Date(); today.setHours(0,0,0,0);
    return d >= today;
  });
  const paidCount = recent.filter((s) => !!s.paid_extension_at).length;
  const avgDur = completedToday.length > 0
    ? Math.round(completedToday.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0) / completedToday.length)
    : 0;

  const STATS = [
    { label: "Live now",            value: liveCount,           icon: Activity,    accent: BRAND_GREEN, bg: BRAND_GREEN_SOFT },
    { label: "Completed today",     value: completedToday.length, icon: CheckCircle2, accent: "#0284c7", bg: "rgba(2, 132, 199, 0.12)" },
    { label: "Total paid sessions", value: paidCount,           icon: CreditCard,  accent: "#7c3aed",   bg: "rgba(124, 58, 237, 0.12)" },
    { label: "Avg duration today",  value: `${avgDur}m`,        icon: TrendingUp,  accent: "#dc2626",   bg: "rgba(220, 38, 38, 0.12)" },
  ];

  const handleTakeNext = async () => {
    const claimed = await takeNext();
    if (claimed) router.push(`/staff/session/${claimed.id}`);
  };

  // Per-row claim — clicking a specific QueueRow takes THAT customer,
  // not the head of the queue. Triage page used to handle this; now we
  // do it inline since /triage has been removed.
  const handleClaim = async (sessionId: string) => {
    const claimed = await claim(sessionId);
    if (claimed) router.push(`/staff/session/${claimed.id}`);
  };

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
            My Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Your sessions and clients
          </p>
        </div>
        <div className="flex items-center gap-3">
          <EngineerAvailabilityToggle />
          {queue.length > 0 && (
            <button
              onClick={handleTakeNext}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              <PhoneIncoming size={14} />
              Take next call · {queue.length} waiting
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border px-4 py-2.5 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: s.bg, color: s.accent }}
              >
                <Icon size={18} />
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--text)" }}>
                  {s.value}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {s.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Incoming for you (above queue) ────────────────────
          Pending engineer-connect-requests (customer pinged you while
          you were Busy) + upcoming engineer_bookings (customer
          scheduled a future slot). Both outrank the anonymous queue
          because the customer specifically asked for you.
       */}
      {hasIncoming && (
        <Section
          title={`Incoming for you (${incomingRequests.length + incomingBookings.length})`}
          subtitle="Customers who asked for you specifically — requests + scheduled calls."
        >
          {incomingRequests.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              busy={actionBusyId === r.id}
              onAccept={() => void onAcceptRequest(r)}
              onDecline={() => void onDeclineRequest(r)}
            />
          ))}
          {incomingBookings.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              busy={actionBusyId === b.id}
              onCancel={() => void onCancelBooking(b)}
            />
          ))}
        </Section>
      )}

      {/* Live queue (urgent / waiting customers — not yet claimed) */}
      {queue.length > 0 && (
        <Section
          title={`Customers waiting (${queue.length})`}
          subtitle="Sorted by urgency. Click a row to take that customer."
        >
          {queue.slice(0, 5).map((s) => (
            <QueueRow key={s.id} session={s} onTake={() => void handleClaim(s.id)} />
          ))}
        </Section>
      )}

      {/* My active sessions */}
      <Section
        title={`Active now (${myActive.length})`}
        subtitle="Sessions you've claimed. Click to enter the session room."
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : myActive.length === 0 ? (
          <EmptyRow text="No active sessions. Claim one from the queue above." />
        ) : (
          myActive.map((s) => <ActiveRow key={s.id} session={s} onOpen={() => router.push(`/staff/session/${s.id}`)} />)
        )}
      </Section>

      {/* Recent log */}
      <Section
        title={`Recent (${recent.length})`}
        subtitle="Last 40 calls — yours and the team's."
      >
        {recent.slice(0, 10).map((s) => (
          <RecentRow key={s.id} session={s} />
        ))}
      </Section>
    </div>
  );
}

// ── UI parts ───────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  link,
  children,
}: {
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-xs underline-offset-4 hover:underline"
            style={{ color: BRAND_GREEN, fontWeight: 500 }}
          >
            {link.label} →
          </Link>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function QueueRow({ session, onTake }: { session: GuestCall; onTake: () => void }) {
  const u = session.urgency;
  const accent = u === "critical" ? { bg: CRIT_RED_SOFT, fg: CRIT_RED }
    : u === "urgent" ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN };
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t" style={{ borderColor: "var(--border)" }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent.fg }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{session.guest_name}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{session.guest_email}</span>
          {u !== "normal" && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: accent.bg, color: accent.fg }}>
              <AlertTriangle size={10} /> {u}
            </span>
          )}
          {session.recall_count > 0 && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              ↻ {session.recall_count}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onTake}
        className="rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90"
        style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
      >
        Take
      </button>
    </div>
  );
}

function ActiveRow({ session, onOpen }: { session: GuestCall; onOpen: () => void }) {
  const elapsedMin = session.joined_at
    ? Math.max(0, Math.floor((Date.now() - new Date(session.joined_at).getTime()) / 60000))
    : 0;
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] border-t"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{session.guest_name}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{session.guest_email}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
            {session.status}
          </span>
        </div>
      </div>
      {session.status === "live" && (
        <span className="font-mono tabular-nums text-xs" style={{ color: "var(--text-muted)" }}>
          {String(elapsedMin).padStart(2, "0")}m
        </span>
      )}
      <span style={{ color: "var(--text-muted)" }}>→</span>
    </button>
  );
}

function RecentRow({ session }: { session: GuestCall }) {
  const cfg = session.status === "live"
    ? { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN, label: "live" }
    : session.status === "queued"
    ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, label: "waiting" }
    : { bg: "color-mix(in srgb, var(--text) 8%, transparent)", fg: "var(--text-muted)", label: session.status };
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: "var(--text)" }}>{session.guest_name}</span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {new Date(session.created_at).toLocaleString([], {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        </div>
      </div>
      {session.duration_minutes != null && (
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {Math.round(Number(session.duration_minutes))}m
        </span>
      )}
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
        {cfg.label}
      </span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-5 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
      {text}
    </div>
  );
}

// ── Incoming-section rows ───────────────────────────────────────────────
function RequestRow({
  request, busy, onAccept, onDecline,
}: {
  request: IncomingRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 border-t px-5 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--warn, " + URGENT_AMBER + ") 4%, transparent)",
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
        style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
      >
        <PhoneIncoming size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
          >
            Request
          </span>
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {request.customerName ?? request.customerEmail ?? "Customer"}
          </span>
          {request.projectName && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              · {request.projectName}
            </span>
          )}
          <span className="ml-auto text-[11px]" style={{ color: "var(--text-faint)" }}>
            {timeAgo(new Date(request.createdAt))}
          </span>
        </div>
        {request.message && (
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            &ldquo;{request.message}&rdquo;
          </p>
        )}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <X size={10} />
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingRow({
  booking, busy, onCancel,
}: {
  booking: IncomingBooking;
  busy: boolean;
  onCancel: () => void;
}) {
  const start = new Date(booking.slotStart);
  const end = new Date(booking.slotEnd);
  const now = Date.now();
  const minsToStart = Math.round((start.getTime() - now) / 60_000);
  const isLive = minsToStart <= 0 && now < end.getTime();
  const isImminent = minsToStart > 0 && minsToStart <= 15;

  const relLabel = isLive
    ? "Live now"
    : isImminent
      ? `In ${minsToStart} min`
      : start.toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

  const accent = isLive ? BRAND_GREEN : isImminent ? URGENT_AMBER : "#0ea5e9";
  const accentSoft = isLive ? BRAND_GREEN_SOFT : isImminent ? URGENT_AMBER_SOFT : "rgba(14, 165, 233, 0.14)";

  return (
    <div
      className="flex items-start gap-3 border-t px-5 py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: accentSoft, color: accent }}
      >
        <CalendarIcon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: accentSoft, color: accent }}
          >
            {isLive ? "Live" : isImminent ? "Soon" : "Scheduled"}
          </span>
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {booking.customerName ?? booking.customerEmail ?? "Customer"}
          </span>
          {booking.projectName && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              · {booking.projectName}
            </span>
          )}
          <span className="ml-auto text-[11px] tabular-nums" style={{ color: "var(--text)" }}>
            {relLabel}
          </span>
        </div>
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} →
          {" "}{end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
        {booking.notes && (
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            &ldquo;{booking.notes}&rdquo;
          </p>
        )}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            title="Cancel this booking"
          >
            <X size={10} />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Relative-time formatter for the request created_at. "Just now" /
// "5 min ago" / "2 hr ago" / "yesterday" / explicit date.
function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
