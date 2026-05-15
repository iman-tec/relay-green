"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import {
  Activity,
  CheckCircle2,
  CreditCard,
  TrendingUp,
  Loader2,
  PhoneIncoming,
  AlertTriangle,
} from "lucide-react";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#d4a017";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const CRIT_RED = "#8b1a1a";
const CRIT_RED_SOFT = "rgba(139, 26, 26, 0.18)";

export function DashboardClient() {
  const router = useRouter();
  const { myActive, queue, recent, loading, error, takeNext, claim } = useEngineerWorkspace();

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
