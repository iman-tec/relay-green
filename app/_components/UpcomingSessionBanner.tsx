"use client";

/*
 * Subtle "you have a scheduled session" indicator for the customer, mounted in
 * the room. Shows the soonest upcoming booking (project · when · engineer) so a
 * customer always knows a future session is coming — separate from the
 * at-slot-time AppointmentPopup. Realtime; hides when nothing is upcoming.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Upcoming = {
  id: string;
  slotStart: string;
  engineerName: string;
  projectName: string;
};

function relWhen(d: Date, nowMs: number): string {
  const now = new Date(nowMs);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

export function UpcomingSessionBanner() {
  const sbRef = useRef(createClient());
  const [items, setItems] = useState<Upcoming[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (uid: string) => {
    const sb = sbRef.current;
    const fromIso = new Date(Date.now() - 60_000).toISOString();
    const toIso = new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString();
    const { data } = await sb
      .from("engineer_bookings")
      .select("id, engineer_user_id, project_id, slot_start")
      .eq("customer_user_id", uid)
      .eq("status", "booked")
      .gte("slot_start", fromIso)
      .lte("slot_start", toIso)
      .order("slot_start", { ascending: true });
    const rows = (data ?? []) as Array<{
      id: string;
      engineer_user_id: string;
      project_id: string | null;
      slot_start: string;
    }>;
    if (rows.length === 0) {
      setItems([]);
      return;
    }

    const engIds = [...new Set(rows.map((r) => r.engineer_user_id))];
    const projIds = [
      ...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x)),
    ];
    const [engRes, projRes] = await Promise.all([
      sb
        .from("engineer_profiles")
        .select("user_id, display_alias")
        .in("user_id", engIds),
      projIds.length
        ? sb.from("projects").select("id, name").in("id", projIds)
        : Promise.resolve({ data: [] }),
    ]);
    const alias = new Map<string, string>();
    for (const e of (engRes.data ?? []) as Array<{
      user_id: string;
      display_alias: string | null;
    }>) {
      if (e.display_alias) alias.set(e.user_id, e.display_alias);
    }
    const pname = new Map<string, string>();
    for (const p of (projRes.data ?? []) as Array<{
      id: string;
      name: string | null;
    }>) {
      if (p.name) pname.set(p.id, p.name);
    }
    setItems(
      rows.map((r) => ({
        id: r.id,
        slotStart: r.slot_start,
        engineerName: alias.get(r.engineer_user_id) ?? "your engineer",
        projectName:
          (r.project_id && pname.get(r.project_id)) || "your project",
      }))
    );
  }, []);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      const { data: u } = await sb.auth.getUser();
      const uid = u.user?.id;
      if (!alive || !uid) return;
      await load(uid);
      if (!alive) return;
      // Unique topic per subscription: removeChannel() only drops the channel
      // from the client's list asynchronously, so reusing a fixed topic can
      // hand back the previous, still-subscribed channel — and .on() after
      // subscribe() throws. A fresh topic each time sidesteps that race.
      const channel = sb
        .channel(`upcoming-session-${uid}-${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "engineer_bookings",
            filter: `customer_user_id=eq.${uid}`,
          },
          () => {
            void load(uid);
          }
        )
        .subscribe();
      // Teardown may have fired during the awaits above (ch was still null);
      // remove the just-created channel so it doesn't leak.
      if (!alive) {
        void sb.removeChannel(channel);
        return;
      }
      ch = channel;
    })();
    return () => {
      alive = false;
      if (ch) void sb.removeChannel(ch);
    };
  }, [load]);

  // Soonest still-upcoming booking.
  const next =
    items.find((i) => new Date(i.slotStart).getTime() > nowMs - 60_000) ?? null;
  if (!next) return null;

  return (
    <div className="pointer-events-none fixed top-3 left-1/2 z-40 -translate-x-1/2 px-4">
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-1.5 shadow-md"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <CalendarClock size={14} style={{ color: "var(--primary)" }} />
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Scheduled session ·{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {next.projectName}
          </span>
          {" · "}
          {relWhen(new Date(next.slotStart), nowMs)} with {next.engineerName}
        </span>
      </div>
    </div>
  );
}
