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
 * Phase-6 restyle: brief §5.4 — chat is ENABLED while ringing. The
 * IntakeAssistant shell + ContextCard mount alongside the pulse on
 * desktop, stack on mobile. All assistant state is LOCAL — when the
 * engineer joins, the customer is redirected to /room (which has its
 * own live chat); persistence of the pre-join transcript is a future
 * backend job (TODO(api) markers in `lib/intake/intakeAssistant.ts` +
 * `IntakeAssistant.tsx`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Home, Volume2, VolumeX } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { RingingBall } from "@/app/_components/RingingBall";
import { Button, Card, CardBody } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";
import { useRingtone } from "@/lib/relay/useRingtone";

// How often to re-check session + offer state. Belt-and-braces in case a
// realtime event drops.
const POLL_MS = 1500;

const ACCEPTED_SESSION_STATES = new Set([
  "assigned",
  "joining",
  "live",
  "grace",
  "ending",
  "expired_free",
]);
const TERMINAL_SESSION_STATES = new Set(["ended", "cancelled", "abandoned"]);

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
  // Bare re-render trigger — clock is computed from Date.now() at render
  // time so we don't store stale time in state. (Using a `now` state
  // captured at mount caused the very first paint to compute a negative
  // elapsedMs against ringStartRef.)
  const [, setTick] = useState(0);
  const guestCallIdRef = useRef<string | null>(null);

  // Ringing-phase start timestamp — used to drive the elapsed-time
  // clock under the big ball. Set the first time the phase enters
  // "ringing"; never reset after that (we don't want a transient
  // realtime hiccup that bounces to loading + back to ringing to
  // restart the timer from 0).
  const ringStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase.kind === "ringing" && ringStartRef.current === null) {
      ringStartRef.current = Date.now();
    }
  }, [phase.kind]);

  // Ringtone audio. Synthesized via Web Audio API so we ship zero
  // audio bytes + can shape it exactly how we want (US-ringback
  // double-tone, 480Hz + 620Hz, 2s pulse + 4s gap). Default is ON;
  // customer can mute via the speaker toggle. Browser autoplay
  // policies usually allow this because the user just navigated
  // here via a click, but if the AudioContext starts in "suspended"
  // state we keep the toggle visible so they can enable manually.
  const [soundOn, setSoundOn] = useState(true);
  const ringtone = useRingtone(phase.kind === "ringing" && soundOn);

  // Sub-second tick so the clock under the ball rolls within ~250ms of
  // crossing the next second, not up to a full second late.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 250);
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
      const gcid =
        (intakeRow as { guest_call_id?: string | null } | null)?.guest_call_id ?? null;
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
      setPhase({ kind: "accepted", guestCallId: gcid });
      return;
    }
    if (sessionStatus && TERMINAL_SESSION_STATES.has(sessionStatus)) {
      setPhase({ kind: "cancelled" });
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
      .filter(
        (o) =>
          o.status === "pending" &&
          new Date(o.expires_at).getTime() > nowMs,
      )
      .sort(
        (a, b) =>
          new Date(b.expires_at).getTime() -
          new Date(a.expires_at).getTime(),
      );

    const sweepNeeded = offers.some(
      (o) =>
        o.status === "pending" &&
        new Date(o.expires_at).getTime() <= nowMs,
    );
    setPhase({
      kind: "ringing",
      livePending: livePending[0] ?? null,
      sweepNeeded,
    });
  }, [intakeId]);

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
        () => {
          void fetchLatest();
        },
      )
      .subscribe();
    const sessionChannel = sb
      .channel(`intake-session:${intakeId}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_calls" },
        () => {
          void fetchLatest();
        },
      )
      .subscribe();
    const poll = setInterval(() => {
      void fetchLatest();
    }, POLL_MS);
    return () => {
      void sb.removeChannel(offerChannel);
      void sb.removeChannel(sessionChannel);
      clearInterval(poll);
    };
  }, [intakeId, fetchLatest]);

  useEffect(() => {
    if (phase.kind !== "accepted") return;
    // Best-effort: ask the edge fn to roll up the bot↔customer transcript
    // into client_intakes.intake_summary so the engineer's tray has signal
    // when they land on /staff/session. Never block redirect on this call;
    // a failure here just leaves the tray showing the raw transcript.
    void supabaseRef.current.functions
      .invoke("summarize-intake", { body: { intake_id: intakeId } })
      .catch((e: unknown) => {
        console.warn("[matching] summarize-intake failed:", e);
      });
    router.replace("/room");
  }, [phase, router, intakeId]);

  const findAnother = useCallback(async () => {
    setRetrying(true);
    const sb = supabaseRef.current;
    // Self-heal: reap any guest_calls stuck in 'assigned'/'joining' with no
    // recent engineer heartbeat. Otherwise those engineers look "in a session"
    // to the matcher and get filtered out, even though they're actually gone.
    // Cheap UPDATE WHERE NOT EXISTS; no-op if nothing is stuck.
    try { await sb.rpc("reap_stale_assigned_sessions"); } catch { /* helper may not be deployed yet */ }
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
        .in("status", [
          "queued",
          "assigned",
          "joining",
          "live",
          "grace",
          "ending",
          "expired_free",
        ]);
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

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <main className="relative flex h-[100dvh] flex-col items-center overflow-hidden bg-[var(--background)] px-4 py-8 sm:px-6 sm:py-10">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--green-dot) 12%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-5xl flex-1 min-h-0 flex-col items-center gap-6">
        <Wordmark />

        {phase.kind === "loading" && (
          <Card variant="surface" className="w-full max-w-md">
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="size-7 animate-spin text-[var(--text-muted)]" />
              <h1 className="font-serif text-xl text-[var(--text)]">
                Looking for an engineer…
              </h1>
            </CardBody>
          </Card>
        )}

        {phase.kind === "ringing" && (
          <RingingHero
            elapsedMs={
              ringStartRef.current !== null ? Date.now() - ringStartRef.current : 0
            }
            soundOn={soundOn}
            soundAvailable={ringtone.available}
            onToggleSound={() => setSoundOn((v) => !v)}
            onCancel={skip}
          />
        )}

        {phase.kind === "no_engineer" && (
          <Card variant="surface" className="w-full max-w-md">
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="inline-flex size-14 items-center justify-center rounded-full bg-[var(--warn-soft)] text-[var(--warn)]">
                <Home className="size-7" />
              </span>
              <h1 className="font-serif text-xl text-[var(--text)]">
                No engineers are online right now
              </h1>
              <p className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
                Try again in a moment — engineers come online throughout the day.
              </p>
              <div className="flex gap-3 pt-3">
                <Button loading={retrying} onClick={findAnother}>
                  Try again
                </Button>
                <Button variant="secondary" onClick={skip}>
                  Back to home
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        {phase.kind === "cancelled" && (
          <Card variant="surface" className="w-full max-w-md">
            <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
              <h1 className="font-serif text-xl text-[var(--text)]">Call ended</h1>
              <p className="text-sm text-[var(--text-muted)]">Taking you back home…</p>
              <BounceHome router={router} />
            </CardBody>
          </Card>
        )}

        {phase.kind === "accepted" && (
          <Card variant="surface" className="w-full max-w-md">
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="size-7 animate-spin text-[var(--ok)]" />
              <h1 className="font-serif text-xl text-[var(--text)]">
                Engineer joined — taking you in…
              </h1>
            </CardBody>
          </Card>
        )}
      </div>
    </main>
  );
}

function BounceHome({ router }: { router: ReturnType<typeof useRouter> }) {
  useEffect(() => {
    const t = setTimeout(() => router.replace("/room"), 800);
    return () => clearTimeout(t);
  }, [router]);
  return null;
}

// ── RingingHero ──────────────────────────────────────────────────────
// The big centred green ball + heartbeat + halo + elapsed-time clock +
// soothing copy + cancel + sound toggle. This is the whole ringing
// surface — no chat, no intake bot, no other entry surfaces. The
// previous design (top pill + IntakeAssistant chat) was replaced
// because the customer's job while waiting is to wait calmly, not to
// fill out a form. The intake context is already captured before the
// session is queued; nothing new is needed during the ring.
function RingingHero({
  elapsedMs,
  soundOn,
  soundAvailable,
  onToggleSound,
  onCancel,
}: {
  elapsedMs: number;
  soundOn: boolean;
  /** True if the AudioContext started successfully — false if the
   *  browser blocked autoplay and the customer has to tap the toggle
   *  to enable. We use this to nudge the icon when it's relevant. */
  soundAvailable: boolean;
  onToggleSound: () => void;
  onCancel: () => void;
}) {
  // Clamp negative values to 0 — the parent's `now` state is captured BEFORE
  // ringStartRef is set on the first render, so the first tick can briefly
  // produce a negative elapsedMs which renders as "00:-1". Without this guard,
  // the customer sees a "-1 seconds" flash when the ringing screen first appears.
  const safeMs = Math.max(0, elapsedMs);
  const mm = Math.floor(safeMs / 60000);
  const ss = Math.floor((safeMs % 60000) / 1000);
  const clock = `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      {/* Ball assembly. Stack of:
            • 3 expanding halo rings (CSS keyframe, staggered phase)
            • Soft glow under the ball
            • The green ball itself with a gentle scale-pulse heartbeat
            • Phone icon centered + tiny bobble in cadence with the beat
          Sized so it's clearly the focal point but doesn't crowd the
          page — ~240px on desktop, scales down on mobile via the
          responsive class. */}
      {/* Ringing-ball visual shared with the engineer's
          EngineerIncomingMatch overlay so both surfaces look identical.
          See app/_components/RingingBall.tsx. */}
      <RingingBall />

      {/* Elapsed time — large, serif, calm. mm:ss because we don't
          want to fake-promise "X seconds until next ring" anymore —
          honest waiting clock instead. */}
      <div
        className="font-mono text-4xl tabular-nums tracking-[0.05em]"
        style={{ color: "var(--text)", fontFeatureSettings: '"tnum"' }}
        aria-live="polite"
      >
        {clock}
      </div>

      {/* Soothing copy. Two lines: the action ("ringing") + the
          reassurance ("we'll connect you the moment…"). Spelled out
          so the customer never wonders whether the system is stuck. */}
      <div className="max-w-md space-y-1.5">
        <p className="font-serif text-2xl text-[var(--text)]" style={{ letterSpacing: "-0.01em" }}>
          Ringing your engineers
        </p>
        <p className="text-sm text-[var(--text-muted)]">
          Hang tight — we'll connect you the moment someone picks up.
        </p>
      </div>

      {/* Footer actions: sound toggle + Cancel. Both small + quiet so
          they don't fight the ball for attention. */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onToggleSound}
          aria-label={soundOn ? "Mute ringtone" : "Unmute ringtone"}
          className="flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{
            borderColor: "var(--border)",
            color: soundOn && soundAvailable ? "var(--primary)" : "var(--text-muted)",
          }}
        >
          {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// useRingtone moved to lib/relay/useRingtone.ts — shared with the
// CallingModal in RoomClient so both surfaces ring identically.
