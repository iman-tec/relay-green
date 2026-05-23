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
import { Loader2, Home } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { Button, Card, CardBody, cn } from "@/app/_components/ui";
import { IntakeAssistant } from "@/app/_components/intake/IntakeAssistant";
import { emptyContext, type IntakeContext } from "@/lib/intake/intakeAssistant";
import { createClient } from "@/lib/supabase/browser";

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
  const [now, setNow] = useState(() => Date.now());
  const [intakeCtx, setIntakeCtx] = useState<IntakeContext>(emptyContext);
  const guestCallIdRef = useRef<string | null>(null);

  // Two-step ringing layout. First ~2s the customer sees a centered
  // "Ringing engineers…" hero (iOS-style incoming call). Then it slides
  // up into a pill at the top and the chat fades in below, centered.
  // Once flipped, never flips back — even if phase transitions and
  // returns to ringing.
  const [chatRevealed, setChatRevealed] = useState(false);
  useEffect(() => {
    if (phase.kind !== "ringing" || chatRevealed) return;
    const t = setTimeout(() => setChatRevealed(true), 2000);
    return () => clearTimeout(t);
  }, [phase.kind, chatRevealed]);

  // 1Hz tick for the countdown badge.
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
          <>
            {/* Compact top-pill — iOS/macOS incoming-call style. Visible only
                after the 2s gate. Fixed to viewport top so it survives chat
                scroll. */}
            <div
              aria-hidden={!chatRevealed}
              className={cn(
                "pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4 transition-all duration-500 ease-out",
                chatRevealed
                  ? "translate-y-0 opacity-100"
                  : "-translate-y-8 opacity-0",
              )}
            >
              <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)]/95 px-4 py-2 shadow-lg backdrop-blur">
                <PulseDot compact />
                <span className="text-sm font-medium text-[var(--text)]">
                  Ringing engineers…
                </span>
                {phase.livePending && (
                  <Countdown
                    expiresAt={phase.livePending.expires_at}
                    nowMs={now}
                    compact
                  />
                )}
                <Button variant="secondary" size="sm" onClick={skip}>
                  Cancel
                </Button>
              </div>
            </div>

            {/* Hero card — visible only BEFORE the 2s gate. Fades+shrinks
                out as the chat slides in below. We collapse max-h so it
                doesn't leave a vertical gap once gone. */}
            <div
              className={cn(
                "w-full max-w-md transition-all duration-500 ease-out",
                chatRevealed
                  ? "pointer-events-none max-h-0 -translate-y-2 scale-95 opacity-0 overflow-hidden"
                  : "max-h-[560px] translate-y-0 scale-100 opacity-100",
              )}
            >
              <Card variant="surface">
                <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
                  <PulseDot />
                  <h1 className="font-serif text-2xl font-medium leading-tight text-[var(--text)]">
                    Ringing engineers…
                  </h1>
                  <p className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
                    {phase.livePending
                      ? "Hang tight — we'll connect you the moment an engineer picks up."
                      : "Your call is open to every available engineer."}
                  </p>
                  {phase.livePending && (
                    <Countdown
                      expiresAt={phase.livePending.expires_at}
                      nowMs={now}
                    />
                  )}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="secondary" size="sm" onClick={skip}>
                      Cancel
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Centered chat — fades in after the 2s gate. Takes the
                remaining viewport height so the composer stays PINNED at
                the bottom and only the thread scrolls (no full-page
                scroll, ChatGPT-style). */}
            <div
              className={cn(
                "flex w-full max-w-2xl flex-1 min-h-0 transition-opacity duration-500 ease-out",
                chatRevealed
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
            >
              <IntakeAssistant
                intakeId={intakeId}
                onContextChange={setIntakeCtx}
              />
            </div>
          </>
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

function PulseDot({ compact = false }: { compact?: boolean }) {
  const outer = compact ? "size-5" : "size-14";
  const inner = compact ? "size-2.5" : "size-8";
  return (
    <div className={cn("relative inline-flex items-center justify-center", outer)}>
      <span
        aria-hidden
        className="absolute inline-flex size-full rounded-full opacity-40 animate-ping"
        style={{ background: "var(--green-dot)" }}
      />
      <span
        aria-hidden
        className={cn("relative inline-flex rounded-full", inner)}
        style={{ background: "var(--green-dot)" }}
        data-relay-pulse
      />
    </div>
  );
}

function Countdown({
  expiresAt,
  nowMs,
  compact = false,
}: {
  expiresAt: string;
  nowMs: number;
  compact?: boolean;
}) {
  const remaining = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000),
  );
  return (
    <p
      className={cn(
        "font-mono tabular-nums text-[var(--text-muted)]",
        compact ? "text-[11px]" : "text-xs",
      )}
      aria-live="polite"
    >
      {compact ? `${remaining}s` : `${remaining}s until next ring`}
    </p>
  );
}
