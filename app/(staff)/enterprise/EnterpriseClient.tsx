"use client";

/*
 * Enterprise admin: org-wide visibility + billing summary.
 * v1: read-only dashboard. Mutation flows ship with Phase 6.5.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  Building2, CreditCard, TrendingUp, Users, Activity, Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

type Wallet = { user_id: string; balance: number };

export function EnterpriseClient() {
  const [sessions, setSessions] = useState<GuestCall[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    const sb = supabaseRef.current;
    const [sRes, wRes] = await Promise.all([
      sb.from("guest_calls").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("credit_wallets").select("user_id, balance").limit(200),
    ]);
    setSessions((sRes.data ?? []) as GuestCall[]);
    setWallets((wRes.data ?? []) as Wallet[]);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const sb = supabaseRef.current;
    const ch = sb
      .channel("relay-enterprise")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_calls" }, () => { void refresh(); })
      .subscribe();
    channelRef.current = ch;
    return () => { sb.removeChannel(ch); channelRef.current = null; };
  }, []);

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const todaySessions = sessions.filter((s) => new Date(s.created_at) >= today);
    const ended = sessions.filter((s) => s.status === "ended");
    const totalMin = ended.reduce((sum, s) => sum + (Number(s.duration_minutes) || 0), 0);
    const avgMin = ended.length === 0 ? 0 : totalMin / ended.length;
    const totalBalance = wallets.reduce((s, w) => s + Number(w.balance || 0), 0);
    return {
      totalSessions: sessions.length,
      todaySessions: todaySessions.length,
      avgDuration: Math.round(avgMin),
      totalCredits: Math.round(totalBalance),
      activeUsers: new Set(sessions.map((s) => s.customer_user_id).filter(Boolean)).size,
    };
  }, [sessions, wallets]);

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Enterprise console</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Organization-wide visibility, billing, and compliance.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} /></div>
      )}

      {!loading && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat icon={Activity}    label="Total sessions"  value={stats.totalSessions} />
            <Stat icon={TrendingUp}  label="Today"           value={stats.todaySessions} />
            <Stat icon={Users}       label="Active customers" value={stats.activeUsers} />
            <Stat icon={CreditCard}  label="Avg duration"    value={`${stats.avgDuration}m`} />
            <Stat icon={Building2}   label="Total credits"   value={stats.totalCredits} />
          </div>

          <div className="rounded-xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
            <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Activity feed</h2>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Latest sessions across the organization.
              </p>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {sessions.slice(0, 30).map((s) => (
                <div key={s.id} className="flex items-center gap-3 border-t px-5 py-2.5" style={{ borderColor: "var(--border)" }}>
                  <span className="h-2 w-2 rounded-full" style={{
                    backgroundColor: s.status === "live" ? BRAND_GREEN : "var(--text-muted)",
                  }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.guest_name}</span>
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {s.guest_email} · {new Date(s.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
                    {s.status}
                  </span>
                  {s.duration_minutes != null && (
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{Math.round(Number(s.duration_minutes))}m</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
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
