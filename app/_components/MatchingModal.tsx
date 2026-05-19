"use client";

/*
 * Matching overlay — modal version of the matching screen.
 *
 * Mounted inside /room (RoomClient) instead of being its own route. The
 * matching logic — broadcast ring, realtime subs, polling fallback, phase
 * decision, Ring again / Skip — is unchanged from the previous full-page
 * MatchingClient; only the chrome differs (overlay card vs full screen).
 *
 * Props:
 *   intakeId  the client_intakes.id to track
 *   onClose   called when the customer wants to dismiss (Skip / accepted /
 *             cancelled). Caller is expected to navigate / reset state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, PhoneOff } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

const BRAND_GREEN = "#3f5c2e";

const POLL_MS = 1500;

const ACCEPTED_SESSION_STATES = new Set([
  "assigned", "joining", "live", "grace", "ending", "expired_free",
]);
const TERMINAL_SESSION_STATES = new Set([
  "ended", "cancelled", "abandoned",
]);

type Offer = {
  id: string;
  intake_id: string;
  guest_call_id: string | null;
  engineer_user_id: string;
  status: "pending" | "accepted" | "declined" | "expired";
  offered_at: string;
  expires_at: string;
};

type Phase =
  | { kind: "loading" }
  | { kind: "ringing"; livePending: Offer | null; sweepNeeded: boolean }
  | { kind: "no_engineer" }
  | { kind: "accepted" };

export function MatchingModal({
  intakeId,
  onClose,
  onAccepted,
}: {
  intakeId: string;
  onClose: () => void;
  /**
   * Called the moment we detect an engineer accepted. Caller typically
   * just closes the modal — useCustomerSession on /room will then load
   * the now-assigned session automatically.
   */
  onAccepted: () => void;
}) {
  const supabaseRef = useRef(createClient());
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const guestCallIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchLatest = useCallback(async () => {
    const sb = supabaseRef.current;

    if (!guestCallIdRef.current) {
      const { data: intakeRow } = await sb
        .from("client_intakes")
        .select("guest_call_id")
        .eq("id", intakeId)
        .maybeSingle();
      const gcid = (intakeRow as { guest_call_id?: string | null } | null)?.guest_call_id ?? null;
      if (gcid) guestCallIdRef.current = gcid;
    }
    const gcid = guestCallIdRef.current;
    if (!gcid) return;

    const { data: sessionRow } = await sb
      .from("guest_calls")
      .select("status")
      .eq("id", gcid)
      .maybeSingle();
    const sessionStatus = (sessionRow as { status?: string } | null)?.status ?? null;

    if (sessionStatus && ACCEPTED_SESSION_STATES.has(sessionStatus)) {
      setPhase({ kind: "accepted" });
      return;
    }
    if (sessionStatus && TERMINAL_SESSION_STATES.has(sessionStatus)) {
      onClose();
      return;
    }

    const { data: offersData } = await sb
      .from("engineer_match_offers")
      .select("*")
      .eq("intake_id", intakeId)
      .eq("guest_call_id", gcid);
    const offers = (offersData ?? []) as Offer[];

    if (offers.length === 0) {
      setPhase({ kind: "no_engineer" });
      return;
    }

    const nowMs = Date.now();
    const livePending = offers
      .filter((o) => o.status === "pending" && new Date(o.expires_at).getTime() > nowMs)
      .sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());
    const sweepNeeded = offers.some(
      (o) => o.status === "pending" && new Date(o.expires_at).getTime() <= nowMs,
    );
    setPhase({
      kind: "ringing",
      livePending: livePending[0] ?? null,
      sweepNeeded,
    });
  }, [intakeId, onClose]);

  useEffect(() => {
    if (phase.kind !== "ringing" || !phase.sweepNeeded) return;
    void supabaseRef.current.rpc("expire_stale_offers").then(() => fetchLatest());
  }, [phase, fetchLatest]);

  useEffect(() => {
    void fetchLatest();
    const sb = supabaseRef.current;
    const offerChannel = sb
      .channel(`intake-modal:${intakeId}:${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "engineer_match_offers",
          filter: `intake_id=eq.${intakeId}`,
        },
        () => { void fetchLatest(); },
      )
      .subscribe();
    const sessionChannel = sb
      .channel(`intake-modal-session:${intakeId}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_calls" },
        () => { void fetchLatest(); },
      )
      .subscribe();
    const poll = setInterval(() => { void fetchLatest(); }, POLL_MS);
    return () => {
      void sb.removeChannel(offerChannel);
      void sb.removeChannel(sessionChannel);
      clearInterval(poll);
    };
  }, [intakeId, fetchLatest]);

  // When acceptance is detected, hand control back to caller. Small delay
  // so the customer sees the "Engineer joined" copy briefly.
  useEffect(() => {
    if (phase.kind !== "accepted") return;
    const t = setTimeout(() => onAccepted(), 600);
    return () => clearTimeout(t);
  }, [phase, onAccepted]);

  const findAnother = useCallback(async () => {
    setRetrying(true);
    const sb = supabaseRef.current;
    await sb.rpc("match_engineer", { _intake_id: intakeId });
    setRetrying(false);
    void fetchLatest();
  }, [intakeId, fetchLatest]);

  const skip = useCallback(async () => {
    const sb = supabaseRef.current;
    const { data: u } = await sb.auth.getUser();
    if (u.user) {
      const { data: mySessions } = await sb
        .from("guest_calls")
        .select("id, status")
        .eq("customer_user_id", u.user.id)
        .in("status", ["queued","assigned","joining","live","grace","ending","expired_free"]);
      const rows = (mySessions ?? []) as { id: string; status: string }[];
      const live = rows.find((r) => ACCEPTED_SESSION_STATES.has(r.status));
      if (live) {
        // Engineer beat us to it — close modal, /room will load the live
        // session via useCustomerSession.
        onAccepted();
        return;
      }
      for (const row of rows) {
        if (row.status === "queued") {
          await sb.rpc("cancel_customer_session", { _session_id: row.id });
        }
      }
    }
    onClose();
  }, [onClose, onAccepted]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: "rgba(20, 18, 14, 0.72)",
        backdropFilter: "blur(4px)",
      }}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-2xl border p-8 shadow-2xl"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        {phase.kind === "loading" && (
          <Centered>
            <Loader2 className="size-8 animate-spin" style={{ color: BRAND_GREEN }} />
            <h2 className="text-lg font-medium">Looking for an engineer…</h2>
          </Centered>
        )}

        {phase.kind === "ringing" && (
          <Centered>
            <PulseDot />
            <h2 className="text-lg font-medium">Ringing engineers…</h2>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {phase.livePending
                ? "We'll connect you the moment one picks up."
                : "Still searching — your call is open to every available engineer."}
            </p>
            {phase.livePending ? (
              <Countdown expiresAt={phase.livePending.expires_at} nowMs={now} />
            ) : null}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={findAnother}
                disabled={retrying}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60"
                style={{ background: BRAND_GREEN }}
              >
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Ring again
              </button>
              <button
                type="button"
                onClick={skip}
                className="rounded-full border px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5"
                style={{ borderColor: "var(--border)" }}
              >
                <PhoneOff className="size-4" />
                Cancel
              </button>
            </div>
          </Centered>
        )}

        {phase.kind === "no_engineer" && (
          <Centered>
            <div
              className="size-12 rounded-full inline-flex items-center justify-center"
              style={{ background: "rgba(212, 160, 23, 0.18)", color: "#d4a017" }}
            >
              <PhoneOff className="size-6" />
            </div>
            <h2 className="text-lg font-medium">No engineers are online right now</h2>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Try again in a moment — engineers come online throughout the day.
            </p>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={findAnother}
                disabled={retrying}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60"
                style={{ background: BRAND_GREEN }}
              >
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Try again
              </button>
              <button
                type="button"
                onClick={skip}
                className="rounded-full border px-5 py-2.5 text-sm font-semibold"
                style={{ borderColor: "var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </Centered>
        )}

        {phase.kind === "accepted" && (
          <Centered>
            <Loader2 className="size-8 animate-spin" style={{ color: BRAND_GREEN }} />
            <h2 className="text-lg font-medium">Engineer joined — taking you in…</h2>
          </Centered>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {children}
    </div>
  );
}

function PulseDot() {
  return (
    <div className="relative size-12 inline-flex items-center justify-center">
      <span
        className="absolute inline-flex size-full rounded-full opacity-50 animate-ping"
        style={{ background: BRAND_GREEN }}
      />
      <span
        className="relative inline-flex size-7 rounded-full"
        style={{ background: BRAND_GREEN }}
      />
    </div>
  );
}

function Countdown({ expiresAt, nowMs }: { expiresAt: string; nowMs: number }) {
  const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000));
  return (
    <p className="text-xs font-mono pt-1" style={{ color: "var(--text-muted)" }}>
      {remaining}s until next ring
    </p>
  );
}
