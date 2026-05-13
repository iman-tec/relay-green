"use client";

/*
 * Internal admin: monitor engineers + supervisors, audit logs, role mgmt.
 *
 * This is intentionally minimal v1:
 *   - Org overview (users, sessions, recent activity)
 *   - Live audit log (paginated)
 *   - Role grant table (set who is engineer/supervisor/admin)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  Users, Activity, ListTree, ShieldCheck, Loader2,
} from "lucide-react";
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
  const [sessions, setSessions] = useState<GuestCall[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    const sb = supabaseRef.current;
    setError(null);
    const [p, r, s, a] = await Promise.all([
      sb.from("profiles").select("id, full_name, primary_role").limit(50),
      sb.from("user_roles").select("user_id, role").limit(200),
      sb.from("guest_calls").select("*").order("created_at", { ascending: false }).limit(50),
      sb.from("session_audit_log").select("*").order("created_at", { ascending: false }).limit(40),
    ]);
    if (p.error) setError(p.error.message);
    setProfiles((p.data ?? []) as Profile[]);
    setRoles((r.data ?? []) as UserRoleRow[]);
    setSessions((s.data ?? []) as GuestCall[]);
    setAudit((a.data ?? []) as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  // Realtime — refresh on guest_calls or audit changes
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

  const stats = useMemo(() => {
    const liveSessions = sessions.filter((s) => s.status === "live").length;
    const queuedSessions = sessions.filter((s) => s.status === "queued").length;
    const engineers = roles.filter((r) => r.role === "engineer").length;
    const supervisors = roles.filter((r) => r.role === "pod_lead" || r.role === "ops_manager").length;
    return { liveSessions, queuedSessions, engineers, supervisors, users: profiles.length };
  }, [sessions, roles, profiles]);

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Internal admin</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Org-wide oversight — users, roles, sessions, and audit trail.
        </p>
      </div>

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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={Users}        label="Users"        value={stats.users} />
        <Stat icon={Users}        label="Engineers"    value={stats.engineers} />
        <Stat icon={ShieldCheck}  label="Supervisors"  value={stats.supervisors} />
        <Stat icon={Activity}     label="Live"         value={stats.liveSessions} />
        <Stat icon={Activity}     label="Queued"       value={stats.queuedSessions} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Users + roles */}
        <Section title="Users & roles" subtitle="Click a role to grant. Click again to revoke (engineer only).">
          {loading ? (
            <Loading />
          ) : (
            <UserRolesTable profiles={profiles} roles={roles} onChange={refresh} />
          )}
        </Section>

        {/* Audit log */}
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

      {/* Recent sessions */}
      <Section title={`Recent sessions (${sessions.length})`} subtitle="Across the whole org.">
        {sessions.slice(0, 12).map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-t px-5 py-2.5" style={{ borderColor: "var(--border)" }}>
            <span className="h-2 w-2 rounded-full" style={{
              backgroundColor: s.status === "live" ? BRAND_GREEN : "var(--text-muted)",
            }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.guest_name}</div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {s.guest_email} · {new Date(s.created_at).toLocaleString()}
              </div>
            </div>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
              {s.status}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-xl font-bold tabular-nums" style={{ color: "var(--text)" }}>{value}</div>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</div>
      </div>
    </div>
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
  profiles, roles, onChange,
}: { profiles: Profile[]; roles: UserRoleRow[]; onChange: () => void | Promise<void> }) {
  const supabase = useRef(createClient()).current;

  const grant = async (userId: string, role: string) => {
    // Note: requires service role for arbitrary user role grants.
    // Self-grant only via dev_grant_my_role; cross-grant comes in a later phase.
    const { error } = await supabase.rpc("dev_grant_my_role", { _role: role });
    if (!error) { void onChange(); return; }
    alert(`Cross-user role grant requires service role. (${error.message})`);
  };

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
