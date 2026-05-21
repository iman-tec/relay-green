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
import { Button, Card, CardBody } from "@/app/_components/ui";
import { IntakeAssistant } from "@/app/_components/intake/IntakeAssistant";
import { ContextCard } from "@/app/_components/intake/ContextCard";
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
    if (phase.kind === "accepted") {
      router.replace("/room");
    }
  }, [phase, router]);

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
    <main className="relative flex min-h-[100dvh] flex-col items-center bg-[var(--background)] px-4 py-8 sm:px-6 sm:py-10">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--green-dot) 12%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl flex flex-col items-center gap-6">
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
          <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* Left: status pulse + context */}
            <div className="flex flex-col gap-5">
              <Card variant="surface">
                <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
                  <PulseDot />
                  <h1 className="font-serif text-2xl font-medium leading-tight text-[var(--text)]">
                    Ringing engineers…
                  </h1>
                  <p className="max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
                    {phase.livePending
                      ? "We'll connect you the moment one picks up. Use the chat below to line up context."
                      : "Still searching — your call is open to every available engineer. Keep typing; your engineer will see everything."}
                  </p>
                  {phase.livePending && (
                    <Countdown expiresAt={phase.livePending.expires_at} nowMs={now} />
                  )}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="secondary" size="sm" onClick={skip}>
                      Cancel
                    </Button>
                  </div>
                </CardBody>
              </Card>

              <ContextCard ctx={intakeCtx} />
            </div>

            {/* Right: chat-while-ringing */}
            <IntakeAssistant onContextChange={setIntakeCtx} />
          </div>
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

function PulseDot() {
  return (
    <div className="relative inline-flex size-14 items-center justify-center">
      <span
        aria-hidden
        className="absolute inline-flex size-full rounded-full opacity-40 animate-ping"
        style={{ background: "var(--green-dot)" }}
      />
      <span
        aria-hidden
        className="relative inline-flex size-8 rounded-full"
        style={{ background: "var(--green-dot)" }}
        data-relay-pulse
      />
    </div>
  );
}

function Countdown({ expiresAt, nowMs }: { expiresAt: string; nowMs: number }) {
  const remaining = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000),
  );
  return (
    <p
      className="font-mono text-xs tabular-nums text-[var(--text-muted)]"
      aria-live="polite"
    >
      {remaining}s until next ring
    </p>
  );
}
