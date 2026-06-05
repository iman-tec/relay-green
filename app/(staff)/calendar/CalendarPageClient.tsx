"use client";

/*
 * Thin client wrapper around the existing CalendarTab so the engineer
 * gets the same editor (weekly pattern + monthly view + holidays +
 * per-date overrides + multi-select) on a standalone page instead of
 * inside the Profile pane's tab list.
 *
 * Banner state is local — toast-style success / error messages while
 * the engineer edits their calendar.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { CalendarTab } from "@/app/_components/EngineerProfilePane";
import { MonthAvailabilityOverview } from "@/app/_components/MonthAvailabilityOverview";
import { SectionHeader, Toast } from "@/app/_components/ui";

type Banner = { tone: "ok" | "risk" | "info"; text: string } | null;

export function CalendarPageClient() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  useEffect(() => {
    let alive = true;
    const sb = createClient();
    void (async () => {
      const { data } = await sb.auth.getUser();
      if (!alive) return;
      if (!data.user) {
        // Server-side StaffGroupLayout has already redirected unauth'd
        // users, but defend-in-depth here too.
        router.push("/staff");
        return;
      }
      setUserId(data.user.id);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const showBanner = useCallback((b: NonNullable<Banner>) => {
    setBanner(b);
    if (b.tone === "ok") setTimeout(() => setBanner(null), 4000);
  }, []);

  if (!userId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading calendar…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      {/* Page header — uses the shared SectionHeader so /calendar reads in the
          same register as /operations and /schedule. */}
      <SectionHeader
        title="Your calendar"
        subtitle="Your availability, holidays and booked appointments at a glance."
      />

      {banner && <Toast tone={banner.tone}>{banner.text}</Toast>}

      {/* Month-at-a-glance overview — holidays / available days / scheduled
          calls for the next 4 weeks, above the weekly + monthly editors. */}
      <MonthAvailabilityOverview />

      <CalendarTab userId={userId} showBanner={showBanner} />
    </div>
  );
}
