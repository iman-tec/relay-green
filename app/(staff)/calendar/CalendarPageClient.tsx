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
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { CalendarTab } from "@/app/_components/EngineerProfilePane";
import { Toast } from "@/app/_components/ui";

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
    return () => { alive = false; };
  }, [router]);

  const showBanner = useCallback((b: NonNullable<Banner>) => {
    setBanner(b);
    if (b.tone === "ok") setTimeout(() => setBanner(null), 4000);
  }, []);

  if (!userId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading calendar…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Page header — matches the dashboard's typographic register so
          jumping between Dashboard / Inbox / Calendar feels uniform. */}
      <header className="mb-6 flex items-baseline gap-3">
        <Sparkles size={14} style={{ color: "var(--primary)" }} />
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          Your calendar
        </h1>
      </header>

      {banner && (
        <div className="mb-4">
          <Toast tone={banner.tone}>{banner.text}</Toast>
        </div>
      )}

      <CalendarTab userId={userId} showBanner={showBanner} />
    </div>
  );
}
