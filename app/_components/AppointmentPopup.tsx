"use client";

/*
 * At-slot-time appointment prompt (customer side). Mounted in the room.
 *
 * Watches the customer's engineer_bookings (realtime + a 30s tick). When a
 * 'booked' slot enters its join window (slot_start − 2 min … slot_end + 10 min)
 * it surfaces a compact card — project, time, engineer — with:
 *   • Join Session  → mints/joins a directed call to the booked engineer
 *                     (mirrors RoomClient's directed-connect), then hops to the
 *                     matching screen.
 *   • Cancel        → reason dropdown (Busy for now / Issue resolved /
 *                     Schedule for later / Other). "Schedule for later" frees
 *                     the slot and reopens the scheduler; other reasons just
 *                     cancel. Both notify the engineer + their supervisor.
 *
 * Styling is intentionally understated: a soft scrim + a small centred card,
 * our theme tokens throughout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ScheduleEngineerModal } from "@/app/_components/ScheduleEngineerModal";

const JOIN_LEAD_MIN = 0;   // notification appears at slot_start (customer starts it)
const GRACE_MIN = 10;      // keep showing this long after slot_end

type Appt = {
  id: string;
  engineerUserId: string;
  projectId: string | null;
  slotStart: string;
  slotEnd: string;
  engineerName: string;
  projectName: string;
};

const CANCEL_REASONS = [
  { key: "busy", label: "Busy for now" },
  { key: "resolved", label: "Issue resolved" },
  { key: "later", label: "Schedule for later" },
  { key: "other", label: "Other" },
] as const;

export function AppointmentPopup() {
  const router = useRouter();
  const sbRef = useRef(createClient());
  const [me, setMe] = useState<string | null>(null);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<{ engineerUserId: string; engineerName: string; projectId: string | null } | null>(null);

  // Tick every 10s so the join window opens + the slot-time auto-start fire
  // promptly without a reload.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (uid: string) => {
    const sb = sbRef.current;
    const fromIso = new Date(Date.now() - GRACE_MIN * 60_000).toISOString();
    const toIso = new Date(Date.now() + 60 * 60_000).toISOString();
    const { data } = await sb
      .from("engineer_bookings")
      .select("id, engineer_user_id, project_id, slot_start, slot_end")
      .eq("customer_user_id", uid)
      .eq("status", "booked")
      .gte("slot_end", fromIso)
      .lte("slot_start", toIso)
      .order("slot_start", { ascending: true });
    const rows = (data ?? []) as Array<{ id: string; engineer_user_id: string; project_id: string | null; slot_start: string; slot_end: string }>;
    if (rows.length === 0) { setAppts([]); return; }

    const engIds = [...new Set(rows.map((r) => r.engineer_user_id))];
    const projIds = [...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x))];
    const [engRes, projRes] = await Promise.all([
      sb.from("engineer_profiles").select("user_id, display_alias").in("user_id", engIds),
      projIds.length ? sb.from("projects").select("id, name").in("id", projIds) : Promise.resolve({ data: [] }),
    ]);
    const aliasById = new Map<string, string>();
    for (const e of (engRes.data ?? []) as Array<{ user_id: string; display_alias: string | null }>) {
      if (e.display_alias) aliasById.set(e.user_id, e.display_alias);
    }
    const nameById = new Map<string, string>();
    for (const p of (projRes.data ?? []) as Array<{ id: string; name: string | null }>) {
      if (p.name) nameById.set(p.id, p.name);
    }
    setAppts(rows.map((r) => ({
      id: r.id,
      engineerUserId: r.engineer_user_id,
      projectId: r.project_id,
      slotStart: r.slot_start,
      slotEnd: r.slot_end,
      engineerName: aliasById.get(r.engineer_user_id) ?? "your engineer",
      projectName: (r.project_id && nameById.get(r.project_id)) || "your project",
    })));
  }, []);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const uid = u.user?.id;
      if (!alive || !uid) return;
      setMe(uid);
      await load(uid);
      if (!alive) return;
      // Unique topic per subscription: removeChannel() only drops the channel
      // from the client's list asynchronously, so reusing a fixed topic can
      // hand back the previous, still-subscribed channel — and .on() after
      // subscribe() throws. A fresh topic each time sidesteps that race.
      const channel = sb
        .channel(`appt-popup-${uid}-${crypto.randomUUID()}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "engineer_bookings", filter: `customer_user_id=eq.${uid}` },
          () => { void load(uid); })
        .subscribe();
      // Teardown may have fired during the awaits above (ch was still null);
      // remove the just-created channel so it doesn't leak.
      if (!alive) { void sb.removeChannel(channel); return; }
      ch = channel;
    })();
    return () => { alive = false; if (ch) void sb.removeChannel(ch); };
  }, [load]);

  // The appointment currently inside its join window (earliest first).
  const active = useMemo(() => {
    return appts.find((a) => {
      if (dismissed.has(a.id)) return false;
      const start = new Date(a.slotStart).getTime();
      const end = new Date(a.slotEnd).getTime();
      return nowMs >= start - JOIN_LEAD_MIN * 60_000 && nowMs <= end + GRACE_MIN * 60_000;
    }) ?? null;
  }, [appts, dismissed, nowMs]);

  const resetPanel = () => { setCancelOpen(false); setReason(null); setError(null); };

  const join = useCallback(async (a: Appt) => {
    setBusy(true); setError(null);
    try {
      const sb = sbRef.current;
      // One server hop: mints the session, ensures the intake, and rings THIS
      // booked engineer directly (regardless of their online toggle / prior
      // history). The engineer's EngineerIncomingMatch popup then offers Accept.
      const { data, error: rpcErr } = await sb.rpc("launch_booked_session", { _booking_id: a.id });
      if (rpcErr) {
        throw new Error(/NO_ENTITLEMENT/.test(rpcErr.message) ? "You're out of session credits." : rpcErr.message);
      }
      const row = (Array.isArray(data) ? data[0] : data) as { intake_id: string } | null;
      if (!row?.intake_id) throw new Error("Couldn't start the session.");
      router.replace(`/intake/matching/${row.intake_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join the session.");
      setBusy(false);
    }
  }, [router]);

  const confirmCancel = useCallback(async (a: Appt) => {
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      const sb = sbRef.current;
      if (reason === "later") {
        await sb.rpc("reschedule_booking", { _id: a.id });
        setReschedule({ engineerUserId: a.engineerUserId, engineerName: a.engineerName, projectId: a.projectId });
      } else {
        const label = CANCEL_REASONS.find((r) => r.key === reason)?.label ?? reason;
        await sb.rpc("cancel_booking_with_reason", { _id: a.id, _reason: label });
        setDismissed((prev) => new Set(prev).add(a.id));
      }
      resetPanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cancel.");
    } finally {
      setBusy(false);
    }
  }, [reason]);

  // The call is CUSTOMER-INITIATED: at slot time this popup appears as a
  // notification and the customer clicks "Join session" when they're ready.
  // (No auto-start.)

  // Reschedule modal (opens after "Schedule for later").
  if (reschedule) {
    return (
      <ScheduleEngineerModal
        engineerUserId={reschedule.engineerUserId}
        engineerName={reschedule.engineerName}
        projectId={reschedule.projectId}
        onClose={() => { setReschedule(null); if (me) void load(me); }}
        onBooked={() => { /* modal shows its own confirmation */ }}
      />
    );
  }

  if (!active) return null;
  const start = new Date(active.slotStart);
  const end = new Date(active.slotEnd);
  const timeFmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border p-5 shadow-2xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <CalendarClock size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight" style={{ color: "var(--text)" }}>
              Your session is ready
            </h2>
            <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
              {active.projectName} · with {active.engineerName}
            </p>
            <p className="mt-0.5 text-[13px] font-medium tabular-nums" style={{ color: "var(--text)" }}>
              {timeFmt(start)} – {timeFmt(end)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed((prev) => new Set(prev).add(active.id))}
            aria-label="Dismiss"
            className="rounded-md p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-faint)" }}
          >
            <X size={15} />
          </button>
        </div>

        {error && <p className="mt-3 text-[12px]" style={{ color: "var(--accent-red)" }}>{error}</p>}

        {!cancelOpen ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void join(active)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--primary)" }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />} Join session
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCancelOpen(true)}
              className="rounded-full border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              Why are you cancelling?
            </p>
            <div className="space-y-1">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setReason(r.key)}
                  className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors"
                  style={{
                    borderColor: reason === r.key ? "var(--primary)" : "var(--border)",
                    backgroundColor: reason === r.key ? "var(--primary-soft)" : "transparent",
                    color: "var(--text)",
                  }}
                >
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full border"
                    style={{ borderColor: reason === r.key ? "var(--primary)" : "var(--border-strong)" }}
                  >
                    {reason === r.key && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--primary)" }} />}
                  </span>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy || !reason}
                onClick={() => void confirmCancel(active)}
                className="flex-1 rounded-full py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: reason === "later" ? "var(--primary)" : "var(--accent-red)" }}
              >
                {busy ? <Loader2 size={14} className="mx-auto animate-spin" /> : reason === "later" ? "Reschedule" : "Cancel session"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={resetPanel}
                className="rounded-full border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
