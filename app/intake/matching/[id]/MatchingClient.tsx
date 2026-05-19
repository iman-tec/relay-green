"use client";

/*
 * Customer-side matching screen.
 *
 * The call is "live" as long as the underlying guest_calls row is in
 * 'queued' state. Two paths an engineer can pick it up:
 *
 *   • Push-ring (fast path):  match_engineer broadcasts an offer row to
 *                              every eligible engineer. Engineers on
 *                              /dashboard / /inbox see a ring modal.
 *                              First Accept wins via accept_match's
 *                              atomic claim.
 *
 *   • Pull queue (fallback):  once the offers expire after 90s without
 *                              acceptance, the session falls back into
 *                              list_queue (offer-aware filter). Any
 *                              engineer hitting /dashboard sees it and
 *                              can claim_session it directly.
 *
 * Either way the customer's MatchingClient catches the guest_calls
 * status flip via realtime + polling and redirects to /room.
 *
 * UX states:
 *   loading       initial fetch
 *   ringing       session queued, we're paging engineers (always shown
 *                 while queued — never "give up" automatically)
 *   accepted      engineer picked up → redirect /room
 *   no_engineer   match_engineer found ZERO engineers to ring (e.g. the
 *                 platform literally has no users with engineer role)
 *   cancelled     customer hit Skip / session was abandoned externally
 *
 * Find Another fires match_engineer again — useful to ping engineers
 * who weren't online when the call started. Skip cancels every queued
 * session belonging to the customer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Home } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { createClient } from "@/lib/supabase/browser";

const BRAND_GREEN = "#3f5c2e";

// How often to re-check session + offer state. Belt-and-braces in case a
// realtime event drops.
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
  | { kind: "cancelled" }
  | { kind: "accepted"; guestCallId: string };

export function MatchingClient({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const guestCallIdRef = useRef<string | null>(null);

  // 1Hz tick for the countdown badge.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchLatest = useCallback(async () => {
    const sb = supabaseRef.current;

    // Resolve guest_call_id once from the intake row.
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
    if (!gcid) {
      // Intake hasn't been bound to a session yet — caller is racing us.
      // Try again on next tick.
      return;
    }

    // Strongest signal: the session's own status.
    const { data: sessionRow } = await sb
      .from("guest_calls")
      .select("status")
      .eq("id", gcid)
      .maybeSingle();
    const sessionStatus = (sessionRow as { status?: string } | null)?.status ?? null;

    if (sessionStatus && ACCEPTED_SESSION_STATES.has(sessionStatus)) {
      setPhase({ kind: "accepted", guestCallId: gcid });
      return;
    }
    if (sessionStatus && TERMINAL_SESSION_STATES.has(sessionStatus)) {
      // Customer cancelled (Skip) or watchdog abandoned it.
      setPhase({ kind: "cancelled" });
      return;
    }

    // Session is still queued. Look at offers scoped to THIS session
    // only — old offers from previous attempts (different guest_call_id
    // for the same intake) are ignored.
    const { data: offersData } = await sb
      .from("engineer_match_offers")
      .select("*")
      .eq("intake_id", intakeId)
      .eq("guest_call_id", gcid);
    const offers = (offersData ?? []) as Offer[];

    if (offers.length === 0) {
      // match_engineer didn't ring anyone for this session. Either no
      // eligible engineers exist or the broadcast hasn't run yet.
      setPhase({ kind: "no_engineer" });
      return;
    }

    const nowMs = Date.now();
    const livePending = offers
      .filter((o) => o.status === "pending" && new Date(o.expires_at).getTime() > nowMs)
      .sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());

    // Stay in "ringing" regardless of whether we have a live offer right
    // now. The session is still queued — list_queue falls back to making
    // it visible to all engineers once offers expire, so we never want
    // to show a "give up" screen automatically.
    const sweepNeeded = offers.some(
      (o) => o.status === "pending" && new Date(o.expires_at).getTime() <= nowMs,
    );
    setPhase({
      kind: "ringing",
      livePending: livePending[0] ?? null,
      sweepNeeded,
    });
  }, [intakeId]);

  // Sweep any stale pending offers so the engineer-side modals dismiss
  // themselves. Decoupled from the render path.
  useEffect(() => {
    if (phase.kind !== "ringing" || !phase.sweepNeeded) return;
    void supabaseRef.current.rpc("expire_stale_offers").then(() => fetchLatest());
  }, [phase, fetchLatest]);

  useEffect(() => {
    void fetchLatest();
    const sb = supabaseRef.current;
    const offerChannel = sb
      .channel(`intake:${intakeId}:${Date.now()}`)
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
      .channel(`intake-session:${intakeId}:${Date.now()}`)
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

  useEffect(() => {
    if (phase.kind === "accepted") {
      router.replace("/room");
    }
  }, [phase, router]);

  // Manually re-fire match_engineer — useful for engineers who weren't
  // online during the first broadcast. Same intake, same session, fresh
  // offers.
  const findAnother = useCallback(async () => {
    setRetrying(true);
    const sb = supabaseRef.current;
    await sb.rpc("match_engineer", { _intake_id: intakeId });
    setRetrying(false);
    void fetchLatest();
  }, [intakeId, fetchLatest]);

  // Skip → cancel every queued session belonging to the customer. Defensive
  // against rapid clicks that may have left stray rows. Guarded against
  // the engineer-just-accepted race.
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
        router.replace("/room");
        return;
      }
      for (const row of rows) {
        if (row.status === "queued") {
          await sb.rpc("cancel_customer_session", { _session_id: row.id });
        }
      }
    }
    router.replace("/room");
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-10">
      <div className="w-full max-w-md flex flex-col gap-8">
        <Wordmark />

        {phase.kind === "loading" && (
          <Centered>
            <Loader2 className="size-8 animate-spin" style={{ color: BRAND_GREEN }} />
            <h1 className="text-xl font-medium">Looking for an engineer…</h1>
          </Centered>
        )}

        {phase.kind === "ringing" && (
          <Centered>
            <PulseDot />
            <h1 className="text-xl font-medium">Ringing engineers…</h1>
            <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>
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
                className="rounded-full border px-5 py-2.5 text-sm font-semibold"
                style={{ borderColor: "var(--border)" }}
              >
                Skip
              </button>
            </div>
          </Centered>
        )}

        {phase.kind === "no_engineer" && (
          <Centered>
            <div
              className="size-14 rounded-full inline-flex items-center justify-center"
              style={{ background: "rgba(212, 160, 23, 0.18)", color: "#d4a017" }}
            >
              <Home className="size-7" />
            </div>
            <h1 className="text-xl font-medium">No engineers are online right now</h1>
            <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>
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
                Back to Home
              </button>
            </div>
          </Centered>
        )}

        {phase.kind === "cancelled" && (
          <Centered>
            <h1 className="text-xl font-medium">Call ended</h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Taking you back home…
            </p>
            {/* Side-effect: bounce to /room */}
            <BounceHome router={router} />
          </Centered>
        )}

        {phase.kind === "accepted" && (
          <Centered>
            <Loader2 className="size-8 animate-spin" style={{ color: BRAND_GREEN }} />
            <h1 className="text-xl font-medium">Engineer joined — taking you in…</h1>
          </Centered>
        )}
      </div>
    </div>
  );
}

function BounceHome({ router }: { router: ReturnType<typeof useRouter> }) {
  useEffect(() => {
    const t = setTimeout(() => router.replace("/room"), 800);
    return () => clearTimeout(t);
  }, [router]);
  return null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center pt-12">
      {children}
    </div>
  );
}

function PulseDot() {
  return (
    <div className="relative size-14 inline-flex items-center justify-center">
      <span
        className="absolute inline-flex size-full rounded-full opacity-50 animate-ping"
        style={{ background: BRAND_GREEN }}
      />
      <span
        className="relative inline-flex size-8 rounded-full"
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
