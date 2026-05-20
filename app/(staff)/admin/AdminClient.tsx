"use client";

/*
 * Platform-wide super_admin console.
 *
 * Minimal surface: a 30-day session activity line graph, a users + roles
 * grant table, and a live audit log. Stats, headings, and recent-sessions
 * have been intentionally trimmed — super_admin gets a focused workspace.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ListTree, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";
import { formatRole } from "@/lib/relay/role-labels";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

type Profile = {
  id: string;
  full_name: string | null;
  primary_role: string | null;
};

type UserRoleRow = {
  user_id: string;
  role: string;
};

type AuditRow = {
  id: number;
  session_id: string;
  actor_user_id: string | null;
  action: string;
  from_state: string | null;
  to_state: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export function AdminClient() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<UserRoleRow[]>([]);
  const [sessions, setSessions] = useState<Pick<GuestCall, "id" | "created_at">[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    const sb = supabaseRef.current;
    setError(null);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [p, r, s, a] = await Promise.all([
      sb.from("profiles_with_role").select("id, full_name, primary_role").limit(200),
      sb.from("user_role_names").select("user_id, role").limit(500),
      sb.from("guest_calls").select("id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      sb.from("session_audit_log").select("*").order("created_at", { ascending: false }).limit(40),
    ]);
    if (p.error) setError(p.error.message);
    setProfiles((p.data ?? []) as Profile[]);
    setRoles((r.data ?? []) as UserRoleRow[]);
    setSessions((s.data ?? []) as Pick<GuestCall, "id" | "created_at">[]);
    setAudit((a.data ?? []) as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const sb = supabaseRef.current;
    const ch = sb
      .channel("relay-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_calls" }, () => { void refresh(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_audit_log" }, () => { void refresh(); })
      .subscribe();
    channelRef.current = ch;
    return () => { sb.removeChannel(ch); channelRef.current = null; };
  }, []);

  const buckets = useMemo(() => {
    const out: { day: string; count: number }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      out.push({ day: d.toISOString().slice(0, 10), count: 0 });
    }
    const byDay = new Map(out.map((b) => [b.day, b]));
    for (const s of sessions) {
      const b = byDay.get(s.created_at.slice(0, 10));
      if (b) b.count += 1;
    }
    return out;
  }, [sessions]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4 px-6 py-6">
      {error && (
        <div className="rounded-md border px-4 py-2.5 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}>
          {error}
        </div>
      )}

      <Section title="Activity" subtitle="Daily sessions over the last 30 days.">
        <div className="p-5">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
            </div>
          ) : (
            <ActivityLineChart buckets={buckets} max={maxCount} />
          )}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Users & roles" subtitle="Click a role to grant. Click again to revoke (engineer only).">
          {loading ? (
            <Loading />
          ) : (
            <UserRolesTable profiles={profiles} roles={roles} />
          )}
        </Section>

        <Section title="Audit log" subtitle="Latest 40 events across all sessions.">
          {loading ? (
            <Loading />
          ) : audit.length === 0 ? (
            <Empty text="No audit events yet." />
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {audit.map((a) => <AuditRowDisplay key={a.id} row={a} />)}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function ActivityLineChart({
  buckets, max,
}: {
  buckets: { day: string; count: number }[];
  max: number;
}) {
  const width  = 800;
  const height = 140;
  const padL   = 28;
  const padR   = 12;
  const padTop = 12;
  const padBot = 18;
  const innerW = width - padL - padR;
  const innerH = height - padTop - padBot;

  const tickStep = Math.max(1, Math.ceil(max / 5));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += tickStep) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);

  const yFor = (count: number) => padTop + (1 - count / max) * innerH;
  const points = buckets.map((b, i) => {
    const x = padL + (buckets.length === 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW);
    return { x, y: yFor(b.count), ...b };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-32 w-full"
      role="img"
      aria-label="Daily sessions over the last 30 days"
    >
      <defs>
        <linearGradient id="admin-activity-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={BRAND_GREEN} stopOpacity="0.28" />
          <stop offset="100%" stopColor={BRAND_GREEN} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const y = yFor(t);
        return (
          <g key={i}>
            <line
              x1={padL} x2={width - padR} y1={y} y2={y}
              stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 3"
            />
            <text
              x={padL - 6} y={y + 3}
              textAnchor="end" fontSize="9"
              fill="var(--text-muted)"
              style={{ fontFeatureSettings: "'tnum' 1" }}
            >
              {t}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#admin-activity-area)" />
      <path d={linePath} fill="none" stroke={BRAND_GREEN} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <title>{`${p.day}: ${p.count} session${p.count === 1 ? "" : "s"}`}</title>
          {p.count > 0 && <circle cx={p.x} cy={p.y} r="2.4" fill={BRAND_GREEN} />}
        </g>
      ))}
    </svg>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function UserRolesTable({
  profiles, roles,
}: { profiles: Profile[]; roles: UserRoleRow[] }) {
  return (
    <div className="max-h-[480px] overflow-y-auto">
      {profiles.length === 0 ? (
        <Empty text="No profiles yet." />
      ) : (
        profiles.map((p) => {
          const userRoles = roles.filter((r) => r.user_id === p.id).map((r) => r.role);
          return (
            <div key={p.id} className="flex items-center gap-3 border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
                {(p.full_name || "?")[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm" style={{ color: "var(--text)" }}>{p.full_name ?? "Unnamed"}</div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{formatRole(p.primary_role) || "no primary"}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {userRoles.map((r) => (
                  <span key={r} className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
                    {r}
                  </span>
                ))}
                {userRoles.length === 0 && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>no roles</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function AuditRowDisplay({ row }: { row: AuditRow }) {
  return (
    <div className="border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <ListTree size={11} style={{ color: BRAND_GREEN }} />
        <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{row.action}</span>
        {row.from_state && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {row.from_state} → {row.to_state}
          </span>
        )}
      </div>
      <div className="ml-5 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {new Date(row.created_at).toLocaleString()} · session {row.session_id.slice(0, 8)}…
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 size={18} className="animate-spin" style={{ color: BRAND_GREEN }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="px-5 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>{text}</p>
  );
}
