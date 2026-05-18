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
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const CRIT_RED    = "#8b1a1a";

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
    })();
    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
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
    setBusy(true);
    const sb = supabaseRef.current;
    await sb.rpc("decline_match", { _offer_id: offer.id });
    setBusy(false);
    setOffer(null);
  }, [offer, busy]);

  if (onSessionRoute || !offer) return null;

  const remaining = Math.max(0, Math.ceil((new Date(offer.expires_at).getTime() - now) / 1000));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(20, 18, 14, 0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 pb-4">
          <div
            className="size-11 rounded-full inline-flex items-center justify-center"
            style={{ background: "rgba(63, 92, 46, 0.18)", color: BRAND_GREEN }}
          >
            <Phone className="size-5 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <p className="text-sm font-medium">Incoming match</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {intake?.developing ? `Building: ${intake.developing}` : "A client is asking for you"}
            </p>
          </div>
          <div className="ml-auto text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            {remaining}s
          </div>
        </div>

        {intake?.technologies && intake.technologies.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pb-5">
            {intake.technologies.map((t) => (
              <span
                key={t}
                className="rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--border)" }}
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="flex-1 rounded-full border px-4 py-3 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: CRIT_RED }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="flex-1 rounded-full px-4 py-3 text-sm font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: BRAND_GREEN }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
