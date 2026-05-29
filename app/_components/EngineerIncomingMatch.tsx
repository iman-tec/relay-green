"use client";

/*
 * Engineer-side push-ring for a match offer.
 *
 * Sibling to EngineerIncomingRequest. Where that one watches the legacy
 * queue (anonymous /room sessions), this one watches engineer_match_offers
 * for any pending row targeting the current engineer. Push offers take
 * priority — if both are pending, we show the offer card (since it's
 * already been routed specifically to this engineer).
 *
 * On Accept → accept_match RPC (atomic claim + flip offer) → /staff/session/[id]
 * On Decline → decline_match RPC (adds engineer to intake.declined_by)
 * On expires_at → realtime expire flips the row; modal disappears.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Phone, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { useRingingHud } from "@/lib/relay/ringingHud";
import { RingingBall } from "@/app/_components/RingingBall";
import type { GuestCall } from "@/lib/supabase/types";

type Offer = {
  id: string;
  intake_id: string;
  guest_call_id: string | null;
  engineer_user_id: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expires_at: string;
};

type Intake = {
  id: string;
  developing: string;
  technologies: string[];
  familiarity: string;
};

export function EngineerIncomingMatch() {
  const router = useRouter();
  const pathname = usePathname();
  const supabaseRef = useRef(createClient());
  const myIdRef = useRef<string | null>(null);

  const [offer, setOffer]   = useState<Offer | null>(null);
  const [intake, setIntake] = useState<Intake | null>(null);
  const [busy, setBusy]     = useState(false);
  const [now, setNow]       = useState(() => Date.now());

  // 1Hz tick for countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onSessionRoute = pathname?.startsWith("/staff/session/") ?? false;

  const fetchOffer = useCallback(async () => {
    const myId = myIdRef.current;
    if (!myId) return;
    const sb = supabaseRef.current;
    const { data } = await sb
      .from("engineer_match_offers")
      .select("*")
      .eq("engineer_user_id", myId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("offered_at", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as Offer | undefined;
    if (!row) {
      setOffer(null);
      setIntake(null);
      return;
    }
    setOffer(row);
    const { data: intakeRow } = await sb
      .from("client_intakes")
      .select("id, developing, technologies, familiarity")
      .eq("id", row.intake_id)
      .maybeSingle();
    setIntake((intakeRow as Intake) ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sb = supabaseRef.current;
    // Channel handle stored in the outer scope so the effect's cleanup can
    // remove it even when the async setup is still pending. Without this,
    // a fast remount (HMR, navigation back) re-enters .channel() with the
    // same name and Supabase returns the already-subscribed instance —
    // chaining .on() onto that throws "cannot add postgres_changes after
    // subscribe()". The Date.now() suffix gives each mount its own channel.
    let channel: ReturnType<typeof sb.channel> | null = null;
    // Polling fallback. Realtime INSERT events on engineer_match_offers
    // should fire reliably with the simple direct-equality RLS, but a
    // 2-second poll guarantees a missed event doesn't strand the engineer
    // without a ring.
    let poll: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      if (cancelled || !u.user) return;
      myIdRef.current = u.user.id;
      await fetchOffer();
      if (cancelled) return;
      channel = sb
        .channel(`match-offers:${u.user.id}:${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_match_offers",
            filter: `engineer_user_id=eq.${u.user.id}`,
          },
          () => { void fetchOffer(); },
        )
        .subscribe();
      poll = setInterval(() => { void fetchOffer(); }, 2000);
    })();
    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
      if (poll) clearInterval(poll);
    };
  }, [fetchOffer]);

  // Re-fetch when the countdown hits zero — server-side `expire_stale_offers`
  // may not have fired yet; this clears stale "pending" rows visually.
  useEffect(() => {
    if (!offer) return;
    if (new Date(offer.expires_at).getTime() <= now) {
      void supabaseRef.current.rpc("expire_stale_offers").then(() => fetchOffer());
    }
  }, [offer, now, fetchOffer]);

  // Audio cue + favicon flash + title blink + browser Notification while a
  // pending offer is on screen. Mute toggle is read fresh each render from
  // localStorage (see `setRingMuted` / `isRingMuted`).
  useRingingHud({
    active: !!(offer && !onSessionRoute),
    label: intake?.developing
      ? `📞 Incoming match · ${intake.developing}`
      : "📞 Incoming match",
    body: intake?.technologies?.length
      ? `Stack: ${intake.technologies.slice(0, 4).join(", ")}`
      : "A customer is asking for you.",
    tag: offer?.id,
  });

  const accept = useCallback(async () => {
    if (!offer || busy) return;
    setBusy(true);
    const sb = supabaseRef.current;
    const { data, error } = await sb.rpc("accept_match", { _offer_id: offer.id });
    setBusy(false);
    if (error) {
      // OFFER_NOT_ACTIONABLE → someone else accepted, or expired
      setOffer(null);
      return;
    }
    const session = (Array.isArray(data) ? data[0] : data) as GuestCall;
    if (session?.id) router.push(`/staff/session/${session.id}`);
  }, [offer, busy, router]);

  const decline = useCallback(async () => {
    if (!offer || busy) return;
    const intakeId = offer.intake_id;
    setBusy(true);
    const sb = supabaseRef.current;
    await sb.rpc("decline_match", { _offer_id: offer.id });
    // Immediately re-ring every OTHER online engineer at once (broadcast).
    // The decline trigger also calls match_engineer, but the deployed copy
    // filters on the flaky is_available flag and routinely finds nobody —
    // this endpoint rings anyone heartbeat-fresh, so the broadcast actually
    // goes out. Best-effort: if it fails, the supervisor board is the
    // fallback. See app/api/staff/broadcast-match/route.ts.
    void fetch("/api/staff/broadcast-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intakeId }),
    }).catch(() => {});
    setBusy(false);
    setOffer(null);
  }, [offer, busy]);

  if (onSessionRoute || !offer) return null;

  const remaining = Math.max(0, Math.ceil((new Date(offer.expires_at).getTime() - now) / 1000));
  const subtitle = intake?.developing
    ? `Building: ${intake.developing}`
    : "A customer is asking for you";

  // Mirror the customer's MatchingClient ringing screen: full-bleed dark
  // overlay, RingingBall front-and-centre, mm:ss elapsed clock, soft
  // subtitle, then Accept/Decline below. Same visual language so a
  // customer-side ring and engineer-side ring feel like the same call.
  return (
    <div
      className="fixed inset-0 z-[var(--z-ring)] flex flex-col items-center justify-center gap-8 px-4 py-12 text-center"
      style={{ background: "rgba(15, 15, 15, 0.86)", backdropFilter: "blur(8px)" }}
    >
      <RingingBall />

      <div
        className="font-mono text-4xl tabular-nums tracking-[0.05em]"
        style={{ color: "#fff", fontFeatureSettings: '"tnum"' }}
        aria-live="polite"
      >
        00:{remaining.toString().padStart(2, "0")}
      </div>

      <div className="max-w-md space-y-1.5">
        <p className="font-serif text-2xl" style={{ letterSpacing: "-0.01em", color: "#fff" }}>
          Incoming match
        </p>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
          {subtitle}
        </p>
      </div>

      {intake?.technologies && intake.technologies.length > 0 ? (
        <div className="flex max-w-md flex-wrap justify-center gap-1.5">
          {/* Dedupe before rendering — the intake can carry repeated tech
              tags (e.g. two "Not sure" entries), and React throws
              "two children with the same key" when the tag string is used
              as the key. Unique-by-value keeps one chip per distinct tag. */}
          {Array.from(new Set(intake.technologies)).slice(0, 8).map((t) => (
            <span
              key={t}
              className="rounded-full border px-2.5 py-1 text-xs"
              style={{
                borderColor: "rgba(255,255,255,0.18)",
                color: "rgba(255,255,255,0.85)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={decline}
          disabled={busy}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border px-6 text-sm font-semibold disabled:opacity-50"
          style={{
            borderColor: "rgba(255,255,255,0.2)",
            color: "#fff",
            background: "transparent",
          }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          Decline
        </button>
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-7 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
          style={{
            background: "var(--primary)",
            boxShadow:
              "0 10px 30px color-mix(in srgb, var(--primary) 50%, transparent), " +
              "0 4px 8px color-mix(in srgb, var(--primary) 30%, transparent)",
          }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
          Accept
        </button>
      </div>
    </div>
  );
}
