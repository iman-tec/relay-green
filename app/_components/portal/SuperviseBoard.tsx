"use client";

/*
 * SuperviseBoard — the shared in-console supervise surface for the enterprise
 * and department command centers. Org/dept-scoped, read-only: live, waiting,
 * and recent sessions for the org's (or department's) own members.
 *
 * Console-native by construction — portal Shell layout + KpiRibbon + a single
 * sessions table + DrillPanel row detail, matching Overview / Members / Usage.
 * Replaces the legacy standalone card-grid (EnterpriseSuperviseClient) the
 * admin used to be ejected into via a /supervise link-out.
 *
 * Data: `endpoint` (8s poll + 1s render tick). Both feeds are GDPR-minimized —
 * no customer/member email, no AI summary — so neither is shown. The session
 * shape differs slightly between feeds (enterprise carries engineer + recalls,
 * department doesn't); `showEngineer` / `showRecalls` gate those columns and
 * `personName` reads customerName ?? memberName.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { KpiRibbon, type Kpi } from "@/app/_components/portal/KpiRibbon";
import { DrillPanel } from "@/app/_components/portal/DrillPanel";
import { eur, int } from "@/app/_components/portal/format";

// Superset of both feeds. Optional fields are absent on the department feed.
type RawSession = {
  id: string;
  status: string;
  urgency: string;
  recallCount?: number;
  createdAt: string;
  joinedAt?: string | null;
  durationMinutes: number | null;
  chargeCents: number | null;
  customerName?: string;
  memberName?: string;
  engineerName?: string;
  projectName: string | null;
};

type Session = {
  id: string;
  status: string;
  urgency: string;
  recallCount: number;
  createdAt: string;
  joinedAt: string | null;
  durationMinutes: number | null;
  chargeCents: number | null;
  personName: string;
  engineerName: string;
  projectName: string | null;
};

function normalize(r: RawSession): Session {
  return {
    id: r.id,
    status: r.status,
    urgency: r.urgency ?? "normal",
    recallCount: r.recallCount ?? 0,
    createdAt: r.createdAt,
    joinedAt: r.joinedAt ?? null,
    durationMinutes: r.durationMinutes,
    chargeCents: r.chargeCents,
    personName: r.customerName ?? r.memberName ?? "",
    engineerName: r.engineerName ?? "",
    projectName: r.projectName,
  };
}

const LIVE = new Set(["live", "joining", "grace"]);
const WAITING = new Set(["queued", "assigned"]);
const PAST = new Set(["ended", "cancelled", "abandoned"]);

type Health = "green" | "amber" | "red";

// Mirrors the legacy deriveHealth: deterministic only (no AI sentiment in the
// org/dept feeds).
function deriveHealth(s: Session): Health {
  if (s.urgency === "critical") return "red";
  if (s.status === "grace") return "red";
  if (s.status === "expired_free") return "amber";
  if (s.urgency === "urgent") return "amber";
  if (s.recallCount >= 2) return "red";
  if (s.recallCount >= 1) return "amber";
  if (s.status === "queued" && s.createdAt) {
    // Queue timeout is 90s, so red at 60s (about to time out), amber at 30s.
    const waitSecs = Math.floor(
      (Date.now() - new Date(s.createdAt).getTime()) / 1000
    );
    if (waitSecs >= 60) return "red";
    if (waitSecs >= 30) return "amber";
  }
  return "green";
}

const HEALTH: Record<Health, { color: string; label: string }> = {
  green: { color: "var(--ok)", label: "Healthy" },
  amber: { color: "var(--warn)", label: "Watch" },
  red: { color: "var(--risk)", label: "At risk" },
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fmtClock(secs: number): string {
  if (secs <= 0) return "0:00";
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function elapsedSecs(s: Session, isPast: boolean): number {
  if (isPast) return Math.floor((s.durationMinutes ?? 0) * 60);
  const from = s.joinedAt ?? s.createdAt;
  return Math.floor((Date.now() - new Date(from).getTime()) / 1000);
}

type TabKey = "live" | "waiting" | "past";

export function SuperviseBoard({
  endpoint,
  personLabel,
  showEngineer = false,
  showRecalls = false,
}: {
  endpoint: string;
  /** Column header + drill label for the customer/member name. */
  personLabel: string;
  showEngineer?: boolean;
  showRecalls?: boolean;
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [tab, setTab] = useState<TabKey>("live");
  const [openId, setOpenId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      const res = await fetch(endpoint, { cache: "no-store" });
      const body = await res.json().catch(() => ({ sessions: [] }));
      if (!cancelled) {
        setSessions(((body.sessions ?? []) as RawSession[]).map(normalize));
      }
    };
    void fetchOnce();
    const interval = setInterval(fetchOnce, 8_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [endpoint]);

  // 1-second tick keeps the "live for" / "waiting" timers moving.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { live, waiting, past } = useMemo(() => {
    const live: Session[] = [];
    const waiting: Session[] = [];
    const past: Session[] = [];
    for (const s of sessions ?? []) {
      if (LIVE.has(s.status)) live.push(s);
      else if (WAITING.has(s.status)) waiting.push(s);
      else if (PAST.has(s.status)) past.push(s);
    }
    return { live, waiting, past };
  }, [sessions]);

  const atRisk = useMemo(
    () =>
      [...live, ...waiting].filter((s) => deriveHealth(s) !== "green").length,
    [live, waiting]
  );

  const avgWaitSecs = useMemo(() => {
    if (waiting.length === 0) return 0;
    const total = waiting.reduce(
      (a, s) =>
        a + Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 1000),
      0
    );
    return Math.floor(total / waiting.length);
  }, [waiting]);

  const ribbon: Kpi[] = [
    { label: "Active now", value: int(live.length), anchor: true },
    { label: "Waiting", value: int(waiting.length) },
    { label: "At risk", value: int(atRisk) },
    { label: "Avg wait", value: fmtClock(avgWaitSecs) },
  ];

  const counts: Record<TabKey, number> = {
    live: live.length,
    waiting: waiting.length,
    past: past.length,
  };
  const rows = tab === "live" ? live : tab === "waiting" ? waiting : past;
  const isPast = tab === "past";
  const open = (sessions ?? []).find((s) => s.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <div className="mb-7">
        <h1
          className="font-serif text-[22px] font-semibold"
          style={{ letterSpacing: "-0.01em" }}
        >
          Supervise
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Live, waiting, and recent calls across your{" "}
          {personLabel === "Member" ? "department" : "organization"}. The dot is
          each session&apos;s health — green is healthy, amber needs a look, red
          is at risk.
        </p>
      </div>

      {sessions === null ? (
        <RibbonSkeleton />
      ) : (
        <div className="mb-9">
          <KpiRibbon items={ribbon} />
        </div>
      )}

      {/* Tabs */}
      <div
        className="mb-5 flex items-center gap-1 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        {(["live", "waiting", "past"] as const).map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="relative px-3 py-2 text-[13px] capitalize transition-colors"
              style={{
                color: active ? "var(--text)" : "var(--text-muted)",
                fontWeight: active ? 600 : 500,
              }}
            >
              {t}
              <span
                className="ml-1.5 text-[11px]"
                style={{ color: "var(--text-faint)" }}
              >
                {counts[t]}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute right-2 -bottom-px left-2 h-[2px] rounded-t-sm"
                  style={{ background: "var(--primary)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {sessions === null ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <Empty tab={tab} />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {headers(tab, isPast, personLabel, showEngineer, showRecalls).map(
                ([h, a], i) => (
                  <th
                    key={h || `c${i}`}
                    className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
                    style={{
                      color: "var(--text-muted)",
                      textAlign: a as "left" | "right",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Row
                key={s.id}
                s={s}
                isPast={isPast}
                tab={tab}
                showEngineer={showEngineer}
                showRecalls={showRecalls}
                onOpen={() => setOpenId(s.id)}
              />
            ))}
          </tbody>
        </table>
      )}

      <DrillPanel
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.personName || "Anonymous user"}
        subtitle={open ? cap(open.status) : undefined}
      >
        {open && (
          <Detail
            s={open}
            isPast={PAST.has(open.status)}
            personLabel={personLabel}
            showEngineer={showEngineer}
            showRecalls={showRecalls}
          />
        )}
      </DrillPanel>
    </div>
  );
}

type Col = [string, "left" | "right"];
function headers(
  tab: TabKey,
  isPast: boolean,
  personLabel: string,
  showEngineer: boolean,
  showRecalls: boolean
): Col[] {
  const col = (h: string, a: "left" | "right"): Col => [h, a];
  if (isPast) {
    const cols: Col[] = [col("", "left"), col(personLabel, "left")];
    if (showEngineer) cols.push(col("Engineer", "left"));
    cols.push(col("Project", "left"), col("Duration", "right"));
    if (showRecalls) cols.push(col("Recalls", "right"));
    cols.push(col("Spend", "right"));
    return cols;
  }
  const cols: Col[] = [col("Health", "left"), col(personLabel, "left")];
  if (showEngineer) cols.push(col("Engineer", "left"));
  cols.push(
    col("Project", "left"),
    col("Status", "left"),
    col(tab === "live" ? "Live for" : "Waiting", "right")
  );
  if (showRecalls) cols.push(col("Recalls", "right"));
  return cols;
}

function HealthDot({ health }: { health: Health }) {
  const h = HEALTH[health];
  return (
    <span
      className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap"
      style={{ color: "var(--text-muted)" }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: h.color }}
      />
      {h.label}
    </span>
  );
}

function Row({
  s,
  isPast,
  tab,
  showEngineer,
  showRecalls,
  onOpen,
}: {
  s: Session;
  isPast: boolean;
  tab: TabKey;
  showEngineer: boolean;
  showRecalls: boolean;
  onOpen: () => void;
}) {
  const health = isPast ? "green" : deriveHealth(s);
  return (
    <tr
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="group/row cursor-pointer outline-none"
      style={{ borderBottom: "1px solid var(--border)" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--surface-raised)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {!isPast ? (
        <td className="px-4 py-3">
          <HealthDot health={health} />
        </td>
      ) : (
        <td className="w-6 px-4 py-3" aria-hidden />
      )}
      <td
        className="px-4 py-3 text-[14px] font-medium"
        style={{ color: "var(--text)" }}
      >
        {s.personName || "Anonymous user"}
      </td>
      {showEngineer && (
        <td
          className="px-4 py-3 text-[14px]"
          style={{ color: "var(--text-muted)" }}
        >
          {s.engineerName || "—"}
        </td>
      )}
      <td
        className="px-4 py-3 text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        {s.projectName || "—"}
      </td>
      {!isPast && (
        <td
          className="px-4 py-3 text-[13px] capitalize"
          style={{ color: "var(--text-muted)" }}
        >
          {s.status}
        </td>
      )}
      <Num>{fmtClock(elapsedSecs(s, isPast))}</Num>
      {showRecalls && <Num>{int(s.recallCount)}</Num>}
      {isPast && <Num>{s.chargeCents != null ? eur(s.chargeCents) : "—"}</Num>}
    </tr>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <td
      className="px-4 py-3 text-right font-mono text-[14px] tabular-nums"
      style={{ color: "var(--text)" }}
    >
      {children}
    </td>
  );
}

function Detail({
  s,
  isPast,
  personLabel,
  showEngineer,
  showRecalls,
}: {
  s: Session;
  isPast: boolean;
  personLabel: string;
  showEngineer: boolean;
  showRecalls: boolean;
}) {
  const health = isPast ? "green" : deriveHealth(s);
  return (
    <>
      <div
        className="flex gap-8 border-y py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <Stat
          label={
            isPast ? "Duration" : s.status === "live" ? "Live for" : "Waiting"
          }
          value={fmtClock(elapsedSecs(s, isPast))}
        />
        {showRecalls && <Stat label="Recalls" value={int(s.recallCount)} />}
        {isPast && s.chargeCents != null && (
          <Stat label="Spend" value={eur(s.chargeCents)} />
        )}
      </div>
      <Field k={personLabel} v={s.personName || "Anonymous user"} />
      {showEngineer && <Field k="Engineer" v={s.engineerName || "—"} />}
      <Field k="Project" v={s.projectName || "—"} />
      <Field k="Status" v={cap(s.status)} />
      {!isPast && (
        <div
          className="flex items-center justify-between border-b py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Health
          </span>
          <span className="inline-flex items-center gap-2 text-[14px] font-medium">
            {health !== "green" && (
              <AlertTriangle
                size={13}
                style={{ color: HEALTH[health].color }}
              />
            )}
            {HEALTH[health].label}
          </span>
        </div>
      )}
      <p className="mt-4 text-[12px]" style={{ color: "var(--text-faint)" }}>
        Read-only. Session content (chat, summaries, contact email) isn&apos;t
        shown here by data-protection policy.
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mb-1.5 text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[19px] tabular-nums"
        style={{ color: "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="flex items-center justify-between border-b py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        {k}
      </span>
      <span className="text-[14px] font-medium">{v}</span>
    </div>
  );
}

function Empty({ tab }: { tab: TabKey }) {
  const copy: Record<TabKey, [string, string]> = {
    live: [
      "All quiet",
      "No active calls right now. New activity appears here in real time.",
    ],
    waiting: ["Nothing waiting", "No calls queued to be picked up."],
    past: ["No history yet", "Ended sessions will appear here."],
  };
  const [title, body] = copy[tab];
  return (
    <div
      className="rounded-lg border border-dashed px-8 py-14 text-center"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p className="text-[15px] font-medium" style={{ color: "var(--text)" }}>
        {title}
      </p>
      <p
        className="mx-auto mt-1.5 max-w-sm text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        {body}
      </p>
    </div>
  );
}

function RibbonSkeleton() {
  return (
    <div className="mb-9 flex gap-14">
      {[0, 1, 2, 3].map((i) => (
        <div key={i}>
          <div
            className="mb-2 h-3 w-20 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
          <div
            className="h-7 w-16 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[49px] border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mt-3.5 h-4 w-40 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}
