"use client";

/*
 * Customer-side matching screen.
 *
 * Subscribes to engineer_match_offers for this intake. UX states:
 *
 *   pending         spinner + "Finding the right engineer…"
 *   accepted        redirect to /room (the new session is now live there)
 *   declined / expired
 *                   "Engineer wasn't available" + [Find Another] [Skip]
 *   no_engineer     match_engineer returned NULL → "No engineer available
 *                   right now. Try again later." + [Try Again]
 *
 * Find Another fires match_engineer again — its filter excludes the previous
 * decliner via intake.declined_by.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PhoneOff, RotateCcw, Home } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { createClient } from "@/lib/supabase/browser";

const BRAND_GREEN = "#3f5c2e";

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
  | { kind: "waiting"; offer: Offer }
  | { kind: "no_engineer" }
  | { kind: "rejected"; reason: "declined" | "expired" }
  | { kind: "accepted"; guestCallId: string };

export function MatchingClient({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 1Hz tick used for the offer countdown badge.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchLatest = useCallback(async () => {
    const sb = supabaseRef.current;
    const { data } = await sb
      .from("engineer_match_offers")
      .select("*")
      .eq("intake_id", intakeId)
      .order("offered_at", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as Offer | undefined;
    if (!row) {
      setPhase({ kind: "no_engineer" });
      return;
    }
    if (row.status === "accepted") {
      setPhase({ kind: "accepted", guestCallId: row.guest_call_id ?? "" });
      return;
    }
    if (row.status === "declined" || row.status === "expired") {
      setPhase({ kind: "rejected", reason: row.status });
      return;
    }
    // Pending — but if expires_at has passed, sweep + recheck.
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await sb.rpc("expire_stale_offers");
      // Recurse one level to re-read the now-expired row.
      const { data: again } = await sb
        .from("engineer_match_offers")
        .select("*").eq("id", row.id).single();
      const fresh = again as Offer | null;
      if (fresh?.status === "expired") {
        setPhase({ kind: "rejected", reason: "expired" });
        return;
      }
    }
    setPhase({ kind: "waiting", offer: row });
  }, [intakeId]);

  // Initial load + realtime sub on engineer_match_offers for this intake.
  // Channel name has a per-mount Date.now() suffix so HMR / fast remount
  // doesn't run into the "cannot add postgres_changes after subscribe()"
  // error that Supabase throws when .channel() returns an already-subscribed
  // instance.
  useEffect(() => {
    void fetchLatest();
    const sb = supabaseRef.current;
    const channel = sb
      .channel(`intake:${intakeId}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "engineer_match_offers", filter: `intake_id=eq.${intakeId}` },
        () => { void fetchLatest(); },
      )
      .subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [intakeId, fetchLatest]);

  // When engineer accepts → redirect to /room which loads their session.
  useEffect(() => {
    if (phase.kind === "accepted") {
      router.replace("/room");
    }
  }, [phase, router]);

  // Sweep the expired offer when the local clock catches up — keeps the UI
  // from sitting on a stale "pending" row.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const exp = new Date(phase.offer.expires_at).getTime();
    if (now >= exp) {
      void supabaseRef.current.rpc("expire_stale_offers").then(() => fetchLatest());
    }
  }, [phase, now, fetchLatest]);

  const findAnother = useCallback(async () => {
    setRetrying(true);
    const sb = supabaseRef.current;
    const { data } = await sb.rpc("match_engineer", { _intake_id: intakeId });
    setRetrying(false);
    if (!data) {
      setPhase({ kind: "no_engineer" });
      return;
    }
    void fetchLatest();
  }, [intakeId, fetchLatest]);

  const skip = useCallback(() => router.replace("/"), [router]);

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

        {phase.kind === "waiting" && (
          <Centered>
            <PulseDot />
            <h1 className="text-xl font-medium">Ringing an engineer…</h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              We&apos;ll connect you the moment they pick up.
            </p>
            <Countdown expiresAt={phase.offer.expires_at} nowMs={now} />
          </Centered>
        )}

        {phase.kind === "rejected" && (
          <Centered>
            <div
              className="size-14 rounded-full inline-flex items-center justify-center"
              style={{ background: "rgba(212, 160, 23, 0.18)", color: "#d4a017" }}
            >
              <PhoneOff className="size-7" />
            </div>
            <h1 className="text-xl font-medium">
              {phase.reason === "declined" ? "Engineer wasn't available" : "No response yet"}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Want us to try another match?
            </p>
            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={findAnother}
                disabled={retrying}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60"
                style={{ background: BRAND_GREEN }}
              >
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Find Another Engineer
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
              style={{ background: "rgba(139, 26, 26, 0.18)", color: "#c87c3d" }}
            >
              <Home className="size-7" />
            </div>
            <h1 className="text-xl font-medium">No engineer is available right now</h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Try again in a few minutes — engineers come online throughout the day.
            </p>
            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={findAnother}
                disabled={retrying}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60"
                style={{ background: BRAND_GREEN }}
              >
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Try Again
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
      Auto-retry in {remaining}s
    </p>
  );
}
