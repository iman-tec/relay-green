"use client";

/*
 * In-pane Profile / Calendar / Payouts / Security / Notifications UI for
 * engineers. Mirrors the customer-side AccountPane shape so the engineer
 * surface feels parallel.
 *
 * Tabs:
 *   • Profile        alias + expertise + presence (online/busy/offline)
 *   • Calendar       weekly recurring availability windows
 *   • Payouts        lifetime sessions + minutes (Stripe Connect pending)
 *   • Security       password reset + future 2FA/sessions
 *   • Notifications  email opt-in + desktop app pitch
 *
 * The pane is opened from the StaffShell user menu and unmounted via
 * `onClose`. Identical pattern to AccountPane: pane chrome (header w/ X)
 * lives inside the pane, the parent's job is just to mount/unmount.
 *
 * Building blocks (SectionHead, SectionCard, Toggle, StatusPill, …) are
 * duplicated locally rather than imported from AccountPane to keep the
 * two panes free to diverge — engineers and customers have different
 * needs, and a shared abstraction would need too many escape hatches.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, BellRing, Calendar as CalendarIcon, Check, ChevronRight,
  Clock, Copy, Download as DownloadIcon, Globe, Home, KeyRound, Loader2, Mail,
  Monitor, Plus, ShieldCheck, Sparkles, Trash2,
  TrendingUp, User, Wallet, X, Zap,
} from "lucide-react";
import { Button, Input, Toast, cn } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";

// ── Tab identity ──────────────────────────────────────────────────────────
export type EngineerTab =
  | "profile"
  | "calendar"
  | "payouts"
  | "security"
  | "notifications";

type TabDef = {
  id: EngineerTab;
  label: string;
  description: string;
  Icon: typeof User;
};

const TABS: readonly TabDef[] = [
  { id: "profile",       label: "Profile",       description: "Alias, expertise, presence",  Icon: User },
  { id: "calendar",      label: "Calendar",      description: "Weekly availability windows", Icon: CalendarIcon },
  { id: "payouts",       label: "Payouts",       description: "Sessions, minutes, earnings", Icon: Wallet },
  { id: "security",      label: "Security",      description: "Password and account safety", Icon: ShieldCheck },
  { id: "notifications", label: "Notifications", description: "Email and in-app prefs",      Icon: Bell },
] as const;

// ── Presence ──────────────────────────────────────────────────────────────
type Presence = "online" | "busy" | "offline";

// ── Profile shape ─────────────────────────────────────────────────────────
type EngineerProfile = {
  userId: string;
  alias: string | null;
  expertise: string[];
  technologies: string[];
  experienceLevel: string | null;
  isAvailable: boolean;
  presenceState: Presence;
  emailNotifications: boolean;
};

// ── Calendar shape ────────────────────────────────────────────────────────
type AvailabilityWindow = {
  weekday: number;          // 0–6 (Sun..Sat)
  startMinute: number;      // 0–1439
  endMinute: number;        // exclusive upper bound
  timezone: string;
};

type EngineerHoliday = {
  date: string;             // ISO yyyy-mm-dd
  label: string | null;
  kind: "holiday" | "vacation" | "sick" | "personal" | "other";
};

// India 2026 gazetted holidays — fixed-date ones are accurate; lunar/
// religious dates are approximations the engineer can refine. Best
// effort, not legal advice.
const INDIA_2026_HOLIDAYS: Array<{ date: string; label: string }> = [
  { date: "2026-01-01", label: "New Year's Day" },
  { date: "2026-01-26", label: "Republic Day" },
  { date: "2026-03-04", label: "Holi" },
  { date: "2026-04-03", label: "Good Friday" },
  { date: "2026-04-14", label: "Ambedkar Jayanti" },
  { date: "2026-05-01", label: "Labour Day" },
  { date: "2026-08-15", label: "Independence Day" },
  { date: "2026-10-02", label: "Gandhi Jayanti" },
  { date: "2026-10-20", label: "Diwali" },
  { date: "2026-12-25", label: "Christmas Day" },
];

// ── Earnings shape ────────────────────────────────────────────────────────
type EarningsSummary = {
  totalSessions: number;
  endedSessions: number;
  totalMinutes: number;
  billableMinutes: number;
  lifetimeEarningsCents: number | null;
  mostRecentSessionAt: string | null;
};

type RecentSession = {
  id: string;
  guestName: string | null;
  durationMinutes: number | null;
  status: string;
  createdAt: string;
  projectName: string | null;
};

type Banner = { tone: "ok" | "risk" | "info"; text: string } | null;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ── Timezone preview ────────────────────────────────────────────────────────
// Engineers based in India serve customers in many zones; showing the live
// equivalent of "9am IST" in PT / ET / GMT etc. while planning prevents the
// "I just set 9–5 IST which is midnight–8am for half my customers" mistake.

type TzOption = { id: string; iana: string; label: string; flag: string };

const TZ_OPTIONS: readonly TzOption[] = [
  { id: "PT",   iana: "America/Los_Angeles", label: "US West / PT",    flag: "🇺🇸" },
  { id: "MT",   iana: "America/Denver",      label: "US Mountain / MT", flag: "🇺🇸" },
  { id: "CT",   iana: "America/Chicago",     label: "US Central / CT",  flag: "🇺🇸" },
  { id: "ET",   iana: "America/New_York",    label: "US East / ET",     flag: "🇺🇸" },
  { id: "GMT",  iana: "Europe/London",       label: "UK / GMT",         flag: "🇬🇧" },
  { id: "CET",  iana: "Europe/Berlin",       label: "Central Europe",   flag: "🇩🇪" },
  { id: "GST",  iana: "Asia/Dubai",          label: "Gulf / Dubai",     flag: "🇦🇪" },
  { id: "SGT",  iana: "Asia/Singapore",      label: "Singapore",        flag: "🇸🇬" },
  { id: "JST",  iana: "Asia/Tokyo",          label: "Japan / JST",      flag: "🇯🇵" },
  { id: "AEST", iana: "Australia/Sydney",    label: "Sydney / AEST",    flag: "🇦🇺" },
] as const;

const TZ_DEFAULT_IDS = ["PT", "ET", "GMT"] as const;
const TZ_STORAGE_KEY = "relay-engineer-tz-prefs-v1";

/** Offset of a given IANA timezone from UTC at a given reference date, in
 *  minutes. Positive = ahead of UTC. Uses the Intl trick (toLocaleString
 *  with explicit tz) because Date doesn't expose IANA offsets directly.
 *  The reference date matters for DST resolution — passing `new Date()`
 *  gives "what the offset is right now", which is what an engineer cares
 *  about when reading the calendar. */
function getOffsetMinutes(tz: string, atDate: Date): number {
  try {
    const local = new Date(atDate.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(atDate.toLocaleString("en-US", { timeZone: "UTC" }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    return 0;
  }
}

type Conversion = {
  hh12: number;
  mm: number;
  period: "am" | "pm";
  dayShift: -1 | 0 | 1;
};

function convertMinutes(
  sourceMin: number, sourceTz: string, targetTz: string, refDate = new Date(),
): Conversion {
  const diff = getOffsetMinutes(targetTz, refDate) - getOffsetMinutes(sourceTz, refDate);
  let total = sourceMin + diff;
  let dayShift: -1 | 0 | 1 = 0;
  while (total < 0) { total += 1440; dayShift = -1; }
  while (total >= 1440) { total -= 1440; dayShift = 1; }
  const hh24 = Math.floor(total / 60);
  const mm = total % 60;
  const period: "am" | "pm" = hh24 < 12 ? "am" : "pm";
  const hh12 = hh24 === 0 ? 12 : hh24 > 12 ? hh24 - 12 : hh24;
  return { hh12, mm, period, dayShift };
}

function fmtConversion(c: Conversion): string {
  const time = c.mm === 0 ? `${c.hh12}${c.period}` : `${c.hh12}:${String(c.mm).padStart(2, "0")}${c.period}`;
  const suffix = c.dayShift === -1 ? " (prev)" : c.dayShift === 1 ? " (next)" : "";
  return `${time}${suffix}`;
}

// ──────────────────────────────────────────────────────────────────────────
// EngineerProfilePane — top-level component
// ──────────────────────────────────────────────────────────────────────────
export function EngineerProfilePane({
  userId,
  email,
  initialTab = "profile",
  onClose,
}: {
  userId: string;
  email: string;
  initialTab?: EngineerTab;
  onClose: () => void;
}) {
  const sbRef = useRef(createClient());
  const router = useRouter();

  const [tab, setTab] = useState<EngineerTab>(initialTab);

  // "Home" navigates back to the engineer's primary surface AND tears down
  // the pane state — so whether the customer arrived via /settings (URL)
  // or via the in-sidebar menu (state-only), pressing Home always leaves
  // them on /dashboard with no lingering pane.
  const goHome = useCallback(() => {
    onClose();
    router.push("/dashboard");
  }, [onClose, router]);
  const [profile, setProfile] = useState<EngineerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);
  const [resetting, setResetting] = useState(false);

  const showBanner = useCallback((b: NonNullable<Banner>) => {
    setBanner(b);
    if (b.tone === "ok") setTimeout(() => setBanner(null), 4000);
  }, []);

  // ── Load engineer profile ──────────────────────────────────────────────
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("engineer_profiles")
        .select(
          "user_id, display_alias, expertise, technologies, experience_level, is_available, presence_state, email_notifications_enabled"
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (!alive) return;
      if (error || !data) {
        setProfile({
          userId,
          alias: null,
          expertise: [],
          technologies: [],
          experienceLevel: null,
          isAvailable: false,
          presenceState: "offline",
          emailNotifications: true,
        });
      } else {
        const row = data as {
          user_id: string;
          display_alias: string | null;
          expertise: string[] | null;
          technologies: string[] | null;
          experience_level: string | null;
          is_available: boolean;
          presence_state: string | null;
          email_notifications_enabled: boolean | null;
        };
        setProfile({
          userId: row.user_id,
          alias: row.display_alias,
          expertise: row.expertise ?? [],
          technologies: row.technologies ?? [],
          experienceLevel: row.experience_level,
          isAvailable: row.is_available,
          presenceState:
            row.presence_state === "online" || row.presence_state === "busy" || row.presence_state === "offline"
              ? (row.presence_state as Presence)
              : row.is_available ? "online" : "offline",
          emailNotifications: row.email_notifications_enabled !== false,
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  // ── Presence change ─────────────────────────────────────────────────────
  // Optimistic update + RPC. Rolls back on error so the UI never lies about
  // what the matcher actually sees.
  const onSetPresence = useCallback(async (next: Presence) => {
    if (!profile) return;
    const previous = profile.presenceState;
    if (previous === next) return;
    setProfile({ ...profile, presenceState: next, isAvailable: next === "online" });
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("set_engineer_presence", { _state: next });
      if (error) throw new Error(error.message);
      showBanner({ tone: "ok", text: `Presence set to ${next}.` });
    } catch (err) {
      setProfile({ ...profile, presenceState: previous, isAvailable: previous === "online" });
      showBanner({
        tone: "risk",
        text: err instanceof Error ? err.message : "Couldn't update presence.",
      });
    }
  }, [profile, showBanner]);

  // ── Email-notifications toggle ──────────────────────────────────────────
  const [emailSaving, setEmailSaving] = useState(false);
  const onToggleEmailNotif = useCallback(async (next: boolean) => {
    if (!profile || emailSaving) return;
    const previous = profile.emailNotifications;
    setProfile({ ...profile, emailNotifications: next });
    setEmailSaving(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb
        .from("engineer_profiles")
        .update({
          email_notifications_enabled: next,
          email_notifications_updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      showBanner({
        tone: "ok",
        text: next ? "Email notifications turned on." : "Email notifications turned off.",
      });
    } catch (err) {
      setProfile({ ...profile, emailNotifications: previous });
      showBanner({
        tone: "risk",
        text: err instanceof Error ? err.message : "Couldn't save preference.",
      });
    } finally {
      setEmailSaving(false);
    }
  }, [profile, emailSaving, userId, showBanner]);

  // ── Reset password ──────────────────────────────────────────────────────
  const onResetPassword = useCallback(async () => {
    if (!email) return;
    setResetting(true);
    setBanner(null);
    try {
      const redirectTo = `${window.location.origin}/set-password?mode=engineer`;
      const { error } = await sbRef.current.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
      showBanner({ tone: "ok", text: `Sent password reset link to ${email}.` });
    } catch (err) {
      showBanner({
        tone: "risk",
        text: err instanceof Error ? err.message : "Could not send reset link.",
      });
    } finally {
      setResetting(false);
    }
  }, [email, showBanner]);

  if (loading || !profile) {
    return (
      <div className="flex h-full items-center justify-center" style={{ backgroundColor: "var(--surface)" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      <header
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Home — primary back-out. Closes the pane state AND routes to
            /dashboard so the URL and the visible content agree afterwards. */}
        <button
          type="button"
          onClick={goHome}
          title="Back to dashboard"
          aria-label="Back to dashboard"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text)" }}
        >
          <Home size={13} />
          Dashboard
        </button>

        {/* Breadcrumb separator — small chevron makes "you are here" feel
            like a nav rather than a standalone screen. */}
        <ChevronRight size={12} style={{ color: "var(--text-faint)" }} />

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <Sparkles size={14} style={{ color: "var(--primary)" }} />
          <h1
            className="truncate text-[14px] font-semibold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Profile &amp; settings
          </h1>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>
      </header>

      {banner && (
        <div className="px-6 pt-4">
          <Toast tone={banner.tone}>{banner.text}</Toast>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SubNav active={tab} onChange={setTab} />

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6 pb-24">
            {tab === "profile" && (
              <ProfileTab
                profile={profile}
                email={email}
                onSetPresence={onSetPresence}
              />
            )}
            {tab === "calendar" && (
              <CalendarTab userId={userId} showBanner={showBanner} />
            )}
            {tab === "payouts" && (
              <PayoutsTab userId={userId} />
            )}
            {tab === "security" && (
              <SecurityTab
                email={email}
                resetting={resetting}
                onResetPassword={onResetPassword}
              />
            )}
            {tab === "notifications" && (
              <NotificationsTab
                emailEnabled={profile.emailNotifications}
                emailSaving={emailSaving}
                onToggleEmail={onToggleEmailNotif}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SubNav
// ──────────────────────────────────────────────────────────────────────────
function SubNav({
  active, onChange,
}: {
  active: EngineerTab;
  onChange: (t: EngineerTab) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="hidden w-[240px] shrink-0 border-r px-3 py-5 md:block"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: "var(--text-faint)" }}
      >
        Settings
      </div>
      <ul className="flex flex-col gap-0.5">
        {TABS.map(({ id, label, description, Icon }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isActive ? "" : "hover:bg-black/5 dark:hover:bg-white/5",
                )}
                style={{
                  backgroundColor: isActive ? "var(--primary-soft)" : "transparent",
                }}
              >
                <Icon
                  size={15}
                  className="mt-0.5 shrink-0"
                  style={{ color: isActive ? "var(--primary)" : "var(--text-muted)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-tight" style={{ color: "var(--text)" }}>
                    {label}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                    {description}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Profile tab
// ──────────────────────────────────────────────────────────────────────────
function ProfileTab({
  profile, email, onSetPresence,
}: {
  profile: EngineerProfile;
  email: string;
  onSetPresence: (p: Presence) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Identity"
        blurb="Your public alias and how customers see you. Real name stays in audit only."
      />

      <SectionCard>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Customer-facing alias
            </span>
            <div
              className="flex h-11 items-center gap-2 rounded-lg border px-3.5 text-[15px]"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text)",
              }}
            >
              <User className="size-4 shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="truncate">{profile.alias ?? "—"}</span>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Auto-assigned at onboarding. Stable per engineer so repeat customers recognise you.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Email
            </span>
            <div
              className="flex h-11 items-center gap-2 rounded-lg border px-3.5 text-[15px]"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-muted)",
              }}
            >
              <Mail className="size-4 shrink-0" />
              <span className="truncate">{email || "—"}</span>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionHead
        title="Presence"
        blurb="What customers see when they hover your phone icon."
      />

      <SectionCard>
        <div className="grid grid-cols-3 gap-2">
          <PresenceOption
            value="online"
            label="Online"
            blurb="Matcher rings me. Customers see green + instant-call."
            color="var(--primary)"
            current={profile.presenceState}
            onClick={() => void onSetPresence("online")}
          />
          <PresenceOption
            value="busy"
            label="Busy"
            blurb="Matcher skips me. Customers can drop a request."
            color="var(--warn)"
            current={profile.presenceState}
            onClick={() => void onSetPresence("busy")}
          />
          <PresenceOption
            value="offline"
            label="Offline"
            blurb="Matcher skips me. Customers see calendar booking."
            color="var(--text-faint)"
            current={profile.presenceState}
            onClick={() => void onSetPresence("offline")}
          />
        </div>
      </SectionCard>

      <SectionHead
        title="Expertise"
        blurb="What you onboarded with. Drives the matcher's routing."
      />

      <SectionCard>
        <div className="flex flex-col gap-4">
          <ReadOnlyChips label="Expertise areas" values={profile.expertise} />
          <ReadOnlyChips label="Technologies" values={profile.technologies} />
          {profile.experienceLevel && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
              <span style={{ color: "var(--text-faint)" }}>Experience level:</span>
              <span style={{ color: "var(--text)" }}>{profile.experienceLevel}</span>
            </div>
          )}
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            To change these, run through engineer onboarding again — or ask a supervisor to override.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function PresenceOption({
  value, label, blurb, color, current, onClick,
}: {
  value: Presence;
  label: string;
  blurb: string;
  color: string;
  current: Presence;
  onClick: () => void;
}) {
  const isActive = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all hover:border-[var(--primary)]"
      style={{
        borderColor: isActive ? color : "var(--border)",
        backgroundColor: isActive ? `color-mix(in srgb, ${color} 8%, var(--surface-raised))` : "var(--surface-raised)",
      }}
      aria-pressed={isActive}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
          {label}
        </span>
        {isActive && <Check size={11} style={{ color }} />}
      </div>
      <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
        {blurb}
      </p>
    </button>
  );
}

function ReadOnlyChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
        {label}
      </span>
      {values.length === 0 ? (
        <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>
          None set.
        </span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="rounded-full border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--text)",
              }}
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Calendar tab — week-at-a-glance availability editor
//
// Layout:
//   ┌─ Presets ────────────────────────────────────┐
//   │ [Weekdays 9–5] [Every day 9–5] [Clear all]   │
//   └──────────────────────────────────────────────┘
//
//   ┌─ Mon · 8h ──────────[+ Add] [⋯]──┐
//   │ [▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭] 24h band
//   │ ● 09:00 – 17:00  (chip, click to edit)
//   └──────────────────────────────────┘
//   ... one row per day, compact ...
//
//   Total: 24h / week
//
// The 24-hour band visualises where the windows are at a glance so the
// engineer reads "Tuesday is empty, Wednesday is mornings only" without
// parsing times. Empty days fade so the eye lands on the active ones.
// ──────────────────────────────────────────────────────────────────────────

type Preset = {
  id: string;
  label: string;
  /** [weekday, startMinute, endMinute] tuples. */
  windows: Array<[number, number, number]>;
};

const PRESETS: Preset[] = [
  {
    id: "weekdays-9-5",
    label: "Weekdays 9–5",
    windows: [1, 2, 3, 4, 5].map((d) => [d, 9 * 60, 17 * 60] as [number, number, number]),
  },
  {
    id: "every-day-9-5",
    label: "Every day 9–5",
    windows: [0, 1, 2, 3, 4, 5, 6].map((d) => [d, 9 * 60, 17 * 60] as [number, number, number]),
  },
  {
    id: "evenings",
    label: "Evenings 6–10",
    windows: [0, 1, 2, 3, 4, 5, 6].map((d) => [d, 18 * 60, 22 * 60] as [number, number, number]),
  },
];

function CalendarTab({
  userId, showBanner,
}: {
  userId: string;
  showBanner: (b: NonNullable<Banner>) => void;
}) {
  const sbRef = useRef(createClient());
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Weekly = recurring pattern editor (default). Monthly = projection view
  // for browsing the next N months with holidays + bookings overlaid.
  const [viewMode, setViewMode] = useState<"weekly" | "monthly">("weekly");

  const tz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }, []);

  // Customer timezones the engineer wants to keep an eye on while planning.
  // Persisted in localStorage so the picker remembers across sessions.
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TZ_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
          setSelectedZoneIds(parsed);
          return;
        }
      }
    } catch { /* corrupt storage — fall through to defaults */ }
    setSelectedZoneIds([...TZ_DEFAULT_IDS]);
  }, []);
  const toggleZone = useCallback((id: string) => {
    setSelectedZoneIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { window.localStorage.setItem(TZ_STORAGE_KEY, JSON.stringify(next)); } catch { /* swallow */ }
      return next;
    });
  }, []);
  const selectedZones = useMemo(
    () => TZ_OPTIONS.filter((o) => selectedZoneIds.includes(o.id)),
    [selectedZoneIds],
  );

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("engineer_availability_windows")
        .select("weekday, start_minute, end_minute, timezone")
        .eq("engineer_user_id", userId)
        .order("weekday")
        .order("start_minute");
      if (!alive) return;
      if (error) {
        showBanner({ tone: "risk", text: error.message });
      } else {
        setWindows(
          (data ?? []).map((r) => {
            const row = r as { weekday: number; start_minute: number; end_minute: number; timezone: string };
            return {
              weekday: row.weekday,
              startMinute: row.start_minute,
              endMinute: row.end_minute,
              timezone: row.timezone,
            };
          })
        );
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, showBanner]);

  // Find a non-overlapping default slot for a fresh window on a day.
  const findFreshSlot = useCallback((weekday: number): [number, number] => {
    const day = windows.filter((w) => w.weekday === weekday);
    const fallback: [number, number] = [9 * 60, 17 * 60];
    if (day.every((w) => w.startMinute !== fallback[0] && (w.endMinute <= fallback[0] || w.startMinute >= fallback[1]))) {
      return fallback;
    }
    // Walk forward in 30-min increments until we find a 1h+ gap.
    const sorted = [...day].sort((a, b) => a.startMinute - b.startMinute);
    let cursor = 0;
    for (const w of sorted) {
      if (w.startMinute - cursor >= 60) return [cursor, Math.min(cursor + 120, w.startMinute)];
      cursor = Math.max(cursor, w.endMinute);
    }
    if (cursor + 60 <= 1440) return [cursor, Math.min(cursor + 120, 1440)];
    return fallback;
  }, [windows]);

  const upsertWindow = useCallback(async (
    weekday: number, oldStartMin: number | null, newStartMin: number, newEndMin: number
  ): Promise<boolean> => {
    if (newStartMin >= newEndMin) {
      showBanner({ tone: "risk", text: "End time must be after start time." });
      return false;
    }
    setBusy(true);
    try {
      const sb = sbRef.current;
      // Composite PK includes start_minute — if the start changed, delete
      // the prior row before inserting so we don't leave a duplicate.
      if (oldStartMin !== null && oldStartMin !== newStartMin) {
        await sb.rpc("remove_engineer_window", { _weekday: weekday, _start_minute: oldStartMin });
      }
      const { error } = await sb.rpc("set_engineer_window", {
        _weekday: weekday,
        _start_minute: newStartMin,
        _end_minute: newEndMin,
        _timezone: tz,
      });
      if (error) throw new Error(error.message);
      setWindows((prev) => {
        const filtered = oldStartMin !== null
          ? prev.filter((w) => !(w.weekday === weekday && w.startMinute === oldStartMin))
          : prev;
        return [...filtered, { weekday, startMinute: newStartMin, endMinute: newEndMin, timezone: tz }]
          .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
      });
      return true;
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't save window." });
      return false;
    } finally {
      setBusy(false);
    }
  }, [tz, showBanner]);

  const removeWindow = useCallback(async (weekday: number, startMin: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("remove_engineer_window", {
        _weekday: weekday,
        _start_minute: startMin,
      });
      if (error) throw new Error(error.message);
      setWindows((prev) => prev.filter((w) => !(w.weekday === weekday && w.startMinute === startMin)));
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't remove window." });
    } finally {
      setBusy(false);
    }
  }, [busy, showBanner]);

  const clearAll = useCallback(async () => {
    if (busy || windows.length === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Clear all ${windows.length} availability windows?`)) return;
    setBusy(true);
    try {
      const sb = sbRef.current;
      // Sequential remove — small N (rarely more than ~20), and gives the
      // server a chance to reject one without orphaning the rest.
      for (const w of windows) {
        await sb.rpc("remove_engineer_window", { _weekday: w.weekday, _start_minute: w.startMinute });
      }
      setWindows([]);
      showBanner({ tone: "ok", text: "Calendar cleared." });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't clear windows." });
    } finally {
      setBusy(false);
    }
  }, [busy, windows, showBanner]);

  const applyPreset = useCallback(async (preset: Preset) => {
    if (busy) return;
    if (windows.length > 0 && typeof window !== "undefined") {
      if (!window.confirm(`Replace your current windows with "${preset.label}"?`)) return;
    }
    setBusy(true);
    try {
      const sb = sbRef.current;
      // Clear existing
      for (const w of windows) {
        await sb.rpc("remove_engineer_window", { _weekday: w.weekday, _start_minute: w.startMinute });
      }
      // Apply preset
      const inserted: AvailabilityWindow[] = [];
      for (const [weekday, startMin, endMin] of preset.windows) {
        const { error } = await sb.rpc("set_engineer_window", {
          _weekday: weekday,
          _start_minute: startMin,
          _end_minute: endMin,
          _timezone: tz,
        });
        if (error) throw new Error(error.message);
        inserted.push({ weekday, startMinute: startMin, endMinute: endMin, timezone: tz });
      }
      setWindows(inserted.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute));
      showBanner({ tone: "ok", text: `Applied: ${preset.label}` });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't apply preset." });
    } finally {
      setBusy(false);
    }
  }, [busy, windows, tz, showBanner]);

  const copyFromDay = useCallback(async (sourceDay: number, targetDay: number) => {
    if (busy || sourceDay === targetDay) return;
    const sourceWindows = windows.filter((w) => w.weekday === sourceDay);
    if (sourceWindows.length === 0) {
      showBanner({ tone: "info", text: `${WEEKDAYS[sourceDay]} has no windows to copy.` });
      return;
    }
    setBusy(true);
    try {
      const sb = sbRef.current;
      // Clear target day first
      const targetWindows = windows.filter((w) => w.weekday === targetDay);
      for (const w of targetWindows) {
        await sb.rpc("remove_engineer_window", { _weekday: w.weekday, _start_minute: w.startMinute });
      }
      // Insert copies
      const inserted: AvailabilityWindow[] = [];
      for (const w of sourceWindows) {
        const { error } = await sb.rpc("set_engineer_window", {
          _weekday: targetDay,
          _start_minute: w.startMinute,
          _end_minute: w.endMinute,
          _timezone: tz,
        });
        if (error) throw new Error(error.message);
        inserted.push({ weekday: targetDay, startMinute: w.startMinute, endMinute: w.endMinute, timezone: tz });
      }
      setWindows((prev) => [
        ...prev.filter((w) => w.weekday !== targetDay),
        ...inserted,
      ].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute));
      showBanner({ tone: "ok", text: `Copied ${WEEKDAYS[sourceDay]} → ${WEEKDAYS[targetDay]}` });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't copy day." });
    } finally {
      setBusy(false);
    }
  }, [busy, windows, tz, showBanner]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="size-4 animate-spin" /> Loading calendar…
      </div>
    );
  }

  const byDay: AvailabilityWindow[][] = Array.from({ length: 7 }, () => []);
  for (const w of windows) byDay[w.weekday].push(w);

  // Total committed minutes for the weekly footer.
  const totalMinutes = windows.reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMinutesRem = totalMinutes % 60;

  // Day labels include hour totals so the eye can spot "busy" vs "empty"
  // without parsing the time band underneath.
  const dayHours = (d: number) => {
    const mins = byDay[d].reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
    if (mins === 0) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHead
        title="Calendar"
        blurb="Recurring weekly availability. Offline customers can book a slot inside these windows."
      />

      {/* ── View toggle + timezone + total hours summary ──── */}
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <div className="flex items-center gap-2">
          {/* Weekly / Monthly tab toggle */}
          <div
            className="inline-flex rounded-full border p-0.5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
            role="tablist"
            aria-label="Calendar view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "weekly"}
              onClick={() => setViewMode("weekly")}
              className="rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
              style={{
                backgroundColor: viewMode === "weekly" ? "var(--primary)" : "transparent",
                color: viewMode === "weekly" ? "#fff" : "var(--text-muted)",
              }}
            >
              Weekly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "monthly"}
              onClick={() => setViewMode("monthly")}
              className="rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
              style={{
                backgroundColor: viewMode === "monthly" ? "var(--primary)" : "transparent",
                color: viewMode === "monthly" ? "#fff" : "var(--text-muted)",
              }}
            >
              Monthly
            </button>
          </div>
          <span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <Globe size={11} />
            <span style={{ color: "var(--text)" }}>{tz}</span>
          </span>
        </div>
        {totalMinutes > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: "color-mix(in srgb, var(--primary) 14%, transparent)",
              color: "var(--primary)",
            }}
          >
            {totalMinutesRem === 0 ? `${totalHours}h` : `${totalHours}h ${totalMinutesRem}m`} / week
          </span>
        )}
      </div>

      {/* Monthly view short-circuits the weekly editor below. */}
      {viewMode === "monthly" && (
        <MonthView
          userId={userId}
          windows={windows}
          sourceTz={tz}
        />
      )}

      {/* The weekly editor + presets + cards only render in Weekly mode;
          Monthly mode is read-only-this-session (edits happen by clicking
          back into Weekly to change the pattern, or by adding holidays). */}
      {viewMode === "weekly" && (
        <>
          {/* ── Customer-zone picker ────────────────────────── */}
          <TimezonePicker
            selectedIds={selectedZoneIds}
            onToggle={toggleZone}
            sourceTz={tz}
          />

      {/* ── Presets bar ─────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-xl border p-2.5"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "color-mix(in srgb, var(--primary) 4%, var(--surface-raised))",
        }}
      >
        <Zap size={12} style={{ color: "var(--primary)" }} className="ml-1" />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Quick set
        </span>
        <div className="ml-1 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => void applyPreset(p)}
              className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--text)",
              }}
            >
              {p.label}
            </button>
          ))}
          {windows.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearAll()}
              className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 40%, transparent)",
                color: "var(--accent-red)",
                backgroundColor: "transparent",
              }}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Day cards ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {WEEKDAYS.map((wdLabel, weekday) => (
          <DayRow
            key={weekday}
            label={wdLabel}
            weekday={weekday}
            hoursLabel={dayHours(weekday)}
            windows={byDay[weekday]}
            allWindows={windows}
            findFreshSlot={() => findFreshSlot(weekday)}
            disabled={busy}
            sourceTz={tz}
            selectedZones={selectedZones}
            onAdd={(start, end) => void upsertWindow(weekday, null, start, end)}
            onUpdate={(oldStart, newStart, newEnd) =>
              void upsertWindow(weekday, oldStart, newStart, newEnd)
            }
            onRemove={(start) => void removeWindow(weekday, start)}
            onCopyFrom={(sourceDay) => void copyFromDay(sourceDay, weekday)}
          />
        ))}
      </div>

          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
            Customers booking from an Offline state see 30-minute slots inside these windows.
            Existing bookings are never affected when you edit a window.
          </p>

          {/* ── Holidays & exceptions ──────────────────────── */}
          <HolidaysSection userId={userId} showBanner={showBanner} />
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MonthView — 12-month projection of the weekly pattern + holiday overrides
//
// Layout: one calendar month at a time with prev/next/today navigation.
// Each day cell shows:
//   - The day number
//   - Projected hours from the weekly windows (small badge)
//   - Strikethrough + holiday chip if the date is in engineer_holidays
//   - Booking dots if customers have booked slots that day
//
// Edits happen elsewhere — to change the recurring pattern, jump back to
// Weekly view; to block a one-off date, use the Holidays section. Clicking
// a date in the month grid opens an inline detail panel that explains
// what's happening on that day (projected window + bookings + holiday
// label) and offers one-click "Block this date" / "Unblock this date".
// ──────────────────────────────────────────────────────────────────────────

type MonthBooking = {
  id: string;
  slotStart: string;
  slotEnd: string;
  customerUserId: string;
};

function MonthView({
  userId, windows, sourceTz,
}: {
  userId: string;
  windows: AvailabilityWindow[];
  sourceTz: string;
}) {
  const sbRef = useRef(createClient());
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [holidaysAll, setHolidaysAll] = useState<EngineerHoliday[]>([]);
  const [bookings, setBookings] = useState<MonthBooking[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Load holidays once for the whole projection horizon (12 months).
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      setLoading(true);
      const fromKey = new Date();
      fromKey.setHours(0, 0, 0, 0);
      const toKey = new Date(fromKey);
      toKey.setFullYear(toKey.getFullYear() + 1);
      const [hRes, bRes] = await Promise.all([
        sb.from("engineer_holidays")
          .select("holiday_date, label, kind")
          .eq("engineer_user_id", userId)
          .gte("holiday_date", fromKey.toISOString().slice(0, 10))
          .lte("holiday_date", toKey.toISOString().slice(0, 10)),
        sb.from("engineer_bookings")
          .select("id, slot_start, slot_end, customer_user_id, status")
          .eq("engineer_user_id", userId)
          .eq("status", "booked")
          .gte("slot_start", fromKey.toISOString())
          .lt("slot_start", toKey.toISOString()),
      ]);
      if (!alive) return;
      const hRows = (hRes.data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string }>;
      setHolidaysAll(hRows.map((r) => ({
        date: r.holiday_date,
        label: r.label,
        kind: (["holiday", "vacation", "sick", "personal", "other"].includes(r.kind)
          ? r.kind : "holiday") as EngineerHoliday["kind"],
      })));
      const bRows = (bRes.data ?? []) as Array<{
        id: string; slot_start: string; slot_end: string; customer_user_id: string;
      }>;
      setBookings(bRows.map((r) => ({
        id: r.id,
        slotStart: r.slot_start,
        slotEnd: r.slot_end,
        customerUserId: r.customer_user_id,
      })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Computed lookups so the cell renderer stays O(1).
  const holidayByDate = useMemo(() => {
    const m = new Map<string, EngineerHoliday>();
    for (const h of holidaysAll) m.set(h.date, h);
    return m;
  }, [holidaysAll]);

  const bookingsByDate = useMemo(() => {
    const m = new Map<string, MonthBooking[]>();
    for (const b of bookings) {
      // Bucket bookings by their start date in the engineer's local clock.
      // Using toLocaleDateString in the source tz gets the right local date
      // regardless of where the rendering user is.
      const key = isoDateInTz(new Date(b.slotStart), sourceTz);
      const list = m.get(key) ?? [];
      list.push(b);
      m.set(key, list);
    }
    return m;
  }, [bookings, sourceTz]);

  // Minutes per weekday (0=Sun..6=Sat) from the recurring pattern.
  const minutesPerWeekday = useMemo(() => {
    const arr = [0, 0, 0, 0, 0, 0, 0];
    for (const w of windows) arr[w.weekday] += (w.endMinute - w.startMinute);
    return arr;
  }, [windows]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  // First day of the visible grid — back to the Sunday of the week
  // containing the 1st so the grid always starts on Sunday.
  const gridStart = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }, [cursor]);

  // 6 weeks * 7 days = 42 cells covers every possible month.
  const cells: Date[] = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      out.push(d);
    }
    return out;
  }, [gridStart]);

  // Navigation helpers — clamp at the 12-month horizon so the engineer
  // can't browse into territory we don't have bookings for.
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const maxCursor = useMemo(() => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 11);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [today]);
  const canPrev = !(cursor.year === today.getFullYear() && cursor.month === today.getMonth());
  const canNext = !(cursor.year === maxCursor.year && cursor.month === maxCursor.month);
  const goPrev = () => {
    setCursor((c) => {
      const next = c.month === 0
        ? { year: c.year - 1, month: 11 }
        : { year: c.year, month: c.month - 1 };
      return next;
    });
  };
  const goNext = () => {
    setCursor((c) => {
      const next = c.month === 11
        ? { year: c.year + 1, month: 0 }
        : { year: c.year, month: c.month + 1 };
      return next;
    });
  };
  const goToday = () => {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedDay(isoDateInTz(today, sourceTz));
  };

  // Per-cell render helpers.
  const cellMinutes = (date: Date): number => {
    if (date.getMonth() !== cursor.month) return 0; // grey out non-month cells
    const dayKey = isoDateInTz(date, sourceTz);
    if (holidayByDate.has(dayKey)) return 0;
    return minutesPerWeekday[date.getDay()];
  };

  const toggleHoliday = useCallback(async (dayKey: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = sbRef.current;
      const existing = holidayByDate.get(dayKey);
      if (existing) {
        const { error } = await sb.rpc("remove_engineer_holiday", { _date: dayKey });
        if (error) throw new Error(error.message);
        setHolidaysAll((prev) => prev.filter((h) => h.date !== dayKey));
      } else {
        const { error } = await sb.rpc("add_engineer_holiday", {
          _date: dayKey, _label: null, _kind: "personal",
        });
        if (error) throw new Error(error.message);
        setHolidaysAll((prev) => [
          ...prev,
          { date: dayKey, label: null, kind: "personal" as const },
        ].sort((a, b) => a.date.localeCompare(b.date)));
      }
    } catch (err) {
      // Surface via console — MonthView has no toast lane of its own.
      console.warn("[month-view] toggle holiday failed:", err);
    } finally {
      setBusy(false);
    }
  }, [busy, holidayByDate]);

  const selectedDate = selectedDay ? new Date(`${selectedDay}T12:00:00`) : null;
  const selectedHoliday = selectedDay ? holidayByDate.get(selectedDay) : undefined;
  const selectedBookings = selectedDay ? (bookingsByDate.get(selectedDay) ?? []) : [];
  const selectedProjectedMinutes = selectedDate && selectedDate.getMonth() === cursor.month
    ? cellMinutes(selectedDate)
    : selectedDate ? (holidayByDate.has(selectedDay!) ? 0 : minutesPerWeekday[selectedDate.getDay()]) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
            aria-label="Previous month"
            title="Previous month"
            style={{ color: "var(--text-muted)" }}
          >
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
          <h3
            className="min-w-[10rem] text-center text-[14px] font-semibold"
            style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
          >
            {monthLabel}
          </h3>
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40"
            aria-label="Next month"
            title="Next month"
            style={{ color: "var(--text-muted)" }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <button
          type="button"
          onClick={goToday}
          className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)]"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Today
        </button>
      </div>

      {/* Grid */}
      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
      >
        {/* Weekday header */}
        <div
          className="grid grid-cols-7 border-b text-center"
          style={{ borderColor: "var(--border)", backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)" }}
        >
          {WEEKDAYS.map((wd) => (
            <span
              key={wd}
              className="py-1.5 text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {wd}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-4 animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((d) => {
              const inMonth = d.getMonth() === cursor.month;
              const isToday = d.getTime() === today.getTime();
              const dayKey = isoDateInTz(d, sourceTz);
              const isSelected = dayKey === selectedDay;
              const holiday = holidayByDate.get(dayKey);
              const bks = bookingsByDate.get(dayKey) ?? [];
              const projMin = inMonth ? cellMinutes(d) : 0;
              const projHours = Math.floor(projMin / 60);
              const projRem = projMin % 60;
              const isPast = d.getTime() < today.getTime();
              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : dayKey)}
                  className="relative flex min-h-[68px] flex-col items-start gap-1 border-b border-r p-1.5 text-left transition-colors last:border-r-0 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: isSelected
                      ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                      : "transparent",
                    opacity: !inMonth ? 0.35 : isPast ? 0.55 : 1,
                  }}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className="text-[12px] font-semibold tabular-nums"
                      style={{
                        color: isToday ? "var(--primary)" : "var(--text)",
                        textDecoration: holiday ? "line-through" : "none",
                      }}
                    >
                      {d.getDate()}
                    </span>
                    {isToday && (
                      <span
                        className="rounded-full px-1 text-[8px] font-bold uppercase tracking-wider"
                        style={{ backgroundColor: "var(--primary)", color: "#fff" }}
                      >
                        Today
                      </span>
                    )}
                  </div>
                  {holiday ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--accent-red) 14%, transparent)",
                        color: "var(--accent-red)",
                      }}
                      title={holiday.label ?? "Off"}
                    >
                      {holiday.label ? truncate(holiday.label, 12) : "Off"}
                    </span>
                  ) : projMin > 0 && inMonth ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      {projRem === 0 ? `${projHours}h` : `${projHours}h${projRem}m`}
                    </span>
                  ) : null}
                  {bks.length > 0 && inMonth && (
                    <div className="flex gap-0.5">
                      {bks.slice(0, 3).map((b) => (
                        <span
                          key={b.id}
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: "#0ea5e9" }}
                          title="Customer booking"
                        />
                      ))}
                      {bks.length > 3 && (
                        <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>
                          +{bks.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend + detail panel */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
          Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: "var(--accent-red)" }} />
          Holiday / off
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: "#0ea5e9" }} />
          Booking
        </span>
      </div>

      {/* Day detail panel — appears below the grid when a date is clicked */}
      {selectedDay && selectedDate && (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
                {selectedDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {selectedHoliday
                  ? `Off — ${selectedHoliday.label ?? selectedHoliday.kind}`
                  : selectedProjectedMinutes > 0
                    ? `Projected ${Math.floor(selectedProjectedMinutes / 60)}h${selectedProjectedMinutes % 60 > 0 ? ` ${selectedProjectedMinutes % 60}m` : ""} from your weekly pattern`
                    : "No availability from your weekly pattern"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Projected windows for the day */}
          {!selectedHoliday && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {windows
                .filter((w) => w.weekday === selectedDate.getDay())
                .sort((a, b) => a.startMinute - b.startMinute)
                .map((w) => (
                  <span
                    key={w.startMinute}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
                      backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
                      color: "var(--primary)",
                    }}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
                    {fmt12h(w.startMinute)} → {fmt12h(w.endMinute)}
                  </span>
                ))}
              {windows.filter((w) => w.weekday === selectedDate.getDay()).length === 0 && (
                <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                  No windows on {WEEKDAYS[selectedDate.getDay()]}s.
                </span>
              )}
            </div>
          )}

          {/* Bookings on this day */}
          {selectedBookings.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Customer bookings
              </span>
              {selectedBookings.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: "#0ea5e9" }} />
                  <span className="tabular-nums">
                    {new Date(b.slotStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {" → "}
                    {new Date(b.slotEnd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Quick action — only allow blocking future dates (past is moot) */}
          {selectedDate.getTime() >= today.getTime() && (
            <button
              type="button"
              onClick={() => void toggleHoliday(selectedDay)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
              style={{
                borderColor: selectedHoliday ? "var(--border)" : "color-mix(in srgb, var(--accent-red) 40%, transparent)",
                color: selectedHoliday ? "var(--text)" : "var(--accent-red)",
              }}
            >
              {selectedHoliday ? "Unblock this date" : "Block this date"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── small helpers used by MonthView ─────────────────────────────────────
function isoDateInTz(d: Date, tz: string): string {
  // Returns the local-date string (yyyy-mm-dd) of d as seen in tz. Used to
  // bucket bookings by the engineer's local date rather than the viewer's.
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

// ── Holidays & exceptions section ────────────────────────────────────────
// One-off date blocks layered on top of the recurring weekly windows.
// Customer-side ScheduleEngineerModal filters slots on these dates so the
// engineer never gets booked on a holiday they've marked.
function HolidaysSection({
  userId, showBanner,
}: {
  userId: string;
  showBanner: (b: NonNullable<Banner>) => void;
}) {
  const sbRef = useRef(createClient());
  const [holidays, setHolidays] = useState<EngineerHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftDate, setDraftDate] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftKind, setDraftKind] = useState<EngineerHoliday["kind"]>("holiday");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeLabel, setRangeLabel] = useState("");

  // Load existing holidays for this engineer.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data, error } = await sb
        .from("engineer_holidays")
        .select("holiday_date, label, kind")
        .eq("engineer_user_id", userId)
        .order("holiday_date", { ascending: true });
      if (!alive) return;
      if (error) {
        showBanner({ tone: "risk", text: error.message });
      } else {
        setHolidays(
          ((data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string }>).map((r) => ({
            date: r.holiday_date,
            label: r.label,
            kind: (["holiday", "vacation", "sick", "personal", "other"].includes(r.kind)
              ? r.kind : "holiday") as EngineerHoliday["kind"],
          }))
        );
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, showBanner]);

  const addOne = useCallback(async (date: string, label: string, kind: EngineerHoliday["kind"]) => {
    if (busy || !date) return false;
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("add_engineer_holiday", {
        _date: date, _label: label, _kind: kind,
      });
      if (error) throw new Error(error.message);
      setHolidays((prev) => {
        const without = prev.filter((h) => h.date !== date);
        return [...without, { date, label: label || null, kind }]
          .sort((a, b) => a.date.localeCompare(b.date));
      });
      return true;
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't add holiday." });
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, showBanner]);

  const removeOne = useCallback(async (date: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("remove_engineer_holiday", { _date: date });
      if (error) throw new Error(error.message);
      setHolidays((prev) => prev.filter((h) => h.date !== date));
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't remove holiday." });
    } finally {
      setBusy(false);
    }
  }, [busy, showBanner]);

  const submitDraft = async () => {
    if (!draftDate) {
      showBanner({ tone: "risk", text: "Pick a date first." });
      return;
    }
    const ok = await addOne(draftDate, draftLabel.trim(), draftKind);
    if (ok) {
      setDraftDate("");
      setDraftLabel("");
      setDraftKind("holiday");
      showBanner({ tone: "ok", text: "Holiday added." });
    }
  };

  const applyIndiaPreset = useCallback(async () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("Add the 10 India 2026 national holidays?")) return;
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("add_engineer_holidays_bulk", {
        _rows: INDIA_2026_HOLIDAYS.map((h) => ({ date: h.date, label: h.label, kind: "holiday" })),
      });
      if (error) throw new Error(error.message);
      // Refresh from server so we get the final state (avoids local merge bugs).
      const { data } = await sb
        .from("engineer_holidays")
        .select("holiday_date, label, kind")
        .eq("engineer_user_id", userId)
        .order("holiday_date", { ascending: true });
      setHolidays(
        ((data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string }>).map((r) => ({
          date: r.holiday_date,
          label: r.label,
          kind: (["holiday", "vacation", "sick", "personal", "other"].includes(r.kind)
            ? r.kind : "holiday") as EngineerHoliday["kind"],
        }))
      );
      showBanner({ tone: "ok", text: "Added India 2026 holidays." });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't apply preset." });
    } finally {
      setBusy(false);
    }
  }, [busy, userId, showBanner]);

  const applyRange = async () => {
    if (busy) return;
    if (!rangeFrom || !rangeTo) {
      showBanner({ tone: "risk", text: "Pick both start and end dates." });
      return;
    }
    const from = new Date(rangeFrom);
    const to = new Date(rangeTo);
    if (to < from) {
      showBanner({ tone: "risk", text: "End date must be on or after start date." });
      return;
    }
    const days: Array<{ date: string; label: string; kind: string }> = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      days.push({
        date: cursor.toISOString().slice(0, 10),
        label: rangeLabel.trim() || "Vacation",
        kind: "vacation",
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (days.length > 60) {
      if (typeof window !== "undefined" && !window.confirm(`Block ${days.length} days? That's a lot.`)) return;
    }
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("add_engineer_holidays_bulk", { _rows: days });
      if (error) throw new Error(error.message);
      setHolidays((prev) => {
        const map = new Map(prev.map((h) => [h.date, h]));
        for (const d of days) map.set(d.date, { date: d.date, label: d.label, kind: d.kind as EngineerHoliday["kind"] });
        return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
      });
      setRangeFrom("");
      setRangeTo("");
      setRangeLabel("");
      showBanner({ tone: "ok", text: `Blocked ${days.length} day${days.length === 1 ? "" : "s"}.` });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't block range." });
    } finally {
      setBusy(false);
    }
  };

  // Group by month for the list.
  const groups = useMemo(() => {
    const map = new Map<string, EngineerHoliday[]>();
    for (const h of holidays) {
      const monthKey = h.date.slice(0, 7);
      const arr = map.get(monthKey) ?? [];
      arr.push(h);
      map.set(monthKey, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [holidays]);

  return (
    <div className="mt-4 flex flex-col gap-4 border-t pt-6" style={{ borderColor: "var(--border)" }}>
      <SectionHead
        title="Holidays & exceptions"
        blurb="Block specific dates on top of your weekly pattern. Customers can't book you on these days."
      />

      {/* Quick adders */}
      <div
        className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-2"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
      >
        {/* Single-day adder */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Add one day
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              className="rounded-md border px-2 py-1 text-[12px] outline-none"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              className="flex-1 rounded-md border px-2 py-1 text-[12px] outline-none min-w-[120px]"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as EngineerHoliday["kind"])}
              className="rounded-md border px-2 py-1 text-[12px] outline-none"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
            >
              <option value="holiday">Public holiday</option>
              <option value="vacation">Vacation</option>
              <option value="sick">Sick day</option>
              <option value="personal">Personal</option>
              <option value="other">Other</option>
            </select>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Plus className="size-3.5" />}
              loading={busy}
              onClick={() => void submitDraft()}
            >
              Add
            </Button>
          </div>
        </div>

        {/* Range adder */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Block a vacation range
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              className="rounded-md border px-2 py-1 text-[12px] outline-none"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
            />
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>→</span>
            <input
              type="date"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              className="rounded-md border px-2 py-1 text-[12px] outline-none"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              placeholder="Label (e.g. Goa trip)"
              value={rangeLabel}
              onChange={(e) => setRangeLabel(e.target.value)}
              className="flex-1 rounded-md border px-2 py-1 text-[12px] outline-none min-w-[120px]"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
            />
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Plus className="size-3.5" />}
              loading={busy}
              onClick={() => void applyRange()}
            >
              Block range
            </Button>
          </div>
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Preset:
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void applyIndiaPreset()}
          className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            color: "var(--text)",
          }}
        >
          🇮🇳 India 2026 holidays ({INDIA_2026_HOLIDAYS.length})
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 className="size-3 animate-spin" /> Loading holidays…
        </div>
      ) : holidays.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>
          No holidays blocked yet. Your full weekly availability applies.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(([monthKey, hs]) => {
            const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString([], {
              month: "long",
              year: "numeric",
            });
            return (
              <div key={monthKey} className="flex flex-col gap-1">
                <span
                  className="px-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-faint)" }}
                >
                  {monthLabel}
                </span>
                <div className="flex flex-col gap-1">
                  {hs.map((h) => <HolidayRow key={h.date} holiday={h} disabled={busy} onRemove={() => void removeOne(h.date)} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HolidayRow({
  holiday, disabled, onRemove,
}: {
  holiday: EngineerHoliday;
  disabled: boolean;
  onRemove: () => void;
}) {
  const d = new Date(`${holiday.date}T00:00:00`);
  const weekday = d.toLocaleDateString([], { weekday: "short" });
  const day = d.toLocaleDateString([], { day: "numeric", month: "short" });
  const kindColor = ({
    holiday: "var(--primary)",
    vacation: "#0ea5e9",
    sick: "var(--accent-red)",
    personal: "#a855f7",
    other: "var(--text-muted)",
  } as const)[holiday.kind];
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex h-9 w-12 shrink-0 flex-col items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${kindColor} 14%, transparent)` }}
      >
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: kindColor }}>
          {weekday}
        </span>
        <span className="-mt-0.5 text-[10px] font-semibold tabular-nums" style={{ color: kindColor }}>
          {day}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
          {holiday.label || (
            <span style={{ color: "var(--text-faint)" }}>(no label)</span>
          )}
        </div>
        <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {holiday.kind}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        title="Remove this holiday"
        aria-label="Remove this holiday"
        className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        style={{ color: "var(--text-muted)" }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ── Single day row — compact, with time-band + pills + add/menu ─────────
function DayRow({
  label, weekday, hoursLabel, windows, allWindows, findFreshSlot,
  disabled, sourceTz, selectedZones,
  onAdd, onUpdate, onRemove, onCopyFrom,
}: {
  label: string;
  weekday: number;
  hoursLabel: string | null;
  windows: AvailabilityWindow[];
  allWindows: AvailabilityWindow[];
  findFreshSlot: () => [number, number];
  disabled: boolean;
  sourceTz: string;
  selectedZones: TzOption[];
  onAdd: (start: number, end: number) => void;
  onUpdate: (oldStart: number, newStart: number, newEnd: number) => void;
  onRemove: (start: number) => void;
  onCopyFrom: (sourceDay: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingStart, setEditingStart] = useState<number | null>(null);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const isOff = windows.length === 0;
  const isWeekend = weekday === 0 || weekday === 6;

  // Days that have windows we could copy FROM (excluding ourselves).
  const copyableDays: number[] = [];
  for (let d = 0; d < 7; d++) {
    if (d !== weekday && allWindows.some((w) => w.weekday === d)) copyableDays.push(d);
  }

  const handleAddClick = () => {
    const [s, e] = findFreshSlot();
    setAdding(true);
    // Reuse editingStart shape — adding state's "no old start" is null.
    // Renders the inline editor below with the suggested slot pre-filled.
    setAddDraft({ start: s, end: e });
  };
  const [addDraft, setAddDraft] = useState<{ start: number; end: number } | null>(null);

  // "+ Add slot" on an empty day reads naturally. Once the day has at
  // least one window, switch to "+ Another" so the engineer discovers
  // they can stack multiple slots (9–1 + 3–8 is the canonical case).
  const addLabel = isOff ? "Add slot" : "Add another";

  return (
    <div
      className="group/day overflow-hidden rounded-2xl border transition-all hover:-translate-y-0.5"
      style={{
        borderColor: isOff ? "color-mix(in srgb, var(--border) 70%, transparent)" : "var(--border)",
        backgroundColor: isOff
          ? "color-mix(in srgb, var(--surface) 50%, transparent)"
          : "var(--surface-raised)",
        // Subtle layered shadow — pops out from the page on hover so the
        // card reads as a tappable surface, not a flat row.
        boxShadow: isOff
          ? "none"
          : "0 1px 0 0 color-mix(in srgb, var(--text) 4%, transparent), 0 1px 3px 0 rgba(0,0,0,0.06)",
      }}
    >
      {/* Header — day label + hours badge + 24h band + actions */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Day stamp — square plaque so days are easy to scan vertically. */}
        <div
          className="flex h-9 w-11 shrink-0 flex-col items-center justify-center rounded-lg"
          style={{
            backgroundColor: isOff
              ? "color-mix(in srgb, var(--text) 4%, transparent)"
              : "color-mix(in srgb, var(--primary) 10%, transparent)",
          }}
        >
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{
              color: isOff ? "var(--text-muted)" : "var(--primary)",
              fontStyle: isWeekend ? "italic" : "normal",
            }}
          >
            {label}
          </span>
          {hoursLabel ? (
            <span
              className="-mt-0.5 text-[8px] font-semibold tabular-nums"
              style={{ color: isOff ? "var(--text-faint)" : "var(--primary)" }}
            >
              {hoursLabel}
            </span>
          ) : (
            <span
              className="-mt-0.5 text-[8px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-faint)" }}
            >
              Off
            </span>
          )}
        </div>

        {/* 24h band — visual ribbon of where the day is committed. Empty
            days get a quiet placeholder line so the row height stays the
            same and the eye can scan the column. */}
        <div
          className="relative h-1.5 flex-1 rounded-full"
          style={{
            backgroundColor: isOff
              ? "color-mix(in srgb, var(--text) 3%, transparent)"
              : "color-mix(in srgb, var(--text) 6%, transparent)",
          }}
        >
          {windows.map((w) => (
            <span
              key={w.startMinute}
              aria-hidden
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${(w.startMinute / 1440) * 100}%`,
                width: `${((w.endMinute - w.startMinute) / 1440) * 100}%`,
                backgroundColor: "var(--primary)",
                boxShadow: "0 0 0 1px color-mix(in srgb, var(--primary) 40%, transparent)",
              }}
            />
          ))}
          {/* Subtle hour ticks at 6 / 12 / 18 — helps the band read as time
              rather than abstract bar. Only render on filled days so empty
              days stay quiet. */}
          {!isOff && [6, 12, 18].map((h) => (
            <span
              key={h}
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-1 w-px -translate-y-1/2"
              style={{
                left: `${(h / 24) * 100}%`,
                backgroundColor: "color-mix(in srgb, var(--text) 14%, transparent)",
              }}
            />
          ))}
        </div>

        {/* Copy-from menu — only shown when other days have windows worth copying. */}
        {copyableDays.length > 0 && (
          <div className="relative">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCopyMenuOpen((v) => !v)}
              title="Copy from another day"
              aria-label="Copy from another day"
              className="inline-flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{ color: "var(--text-muted)" }}
            >
              <Copy size={13} />
            </button>
            {copyMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setCopyMenuOpen(false)}
                  aria-hidden
                />
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-lg border shadow-xl"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <div
                    className="border-b px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
                  >
                    Copy from
                  </div>
                  {copyableDays.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setCopyMenuOpen(false); onCopyFrom(d); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ color: "var(--text)" }}
                    >
                      {WEEKDAYS[d]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Primary action — "Add slot" on empty days, "Add another" when
            the day already has at least one window. Copy disambiguates
            the "you can stack multiple slots in one day" affordance. */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleAddClick}
          title={addLabel}
          aria-label={addLabel}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
          style={{ color: "var(--primary)" }}
        >
          <Plus size={12} />
          {addLabel}
        </button>
      </div>

      {/* Window pills row — clickable to edit. Sits in its own padded
          section so the chips have breathing room from the header.
          The inline "+ Add another slot" button at the bottom is the
          primary discoverability fix for multi-slot days — the header
          button is too far away from the pills to read as "stack
          another slot on top of these." */}
      {!isOff && (
        <div className="flex flex-col gap-1.5 px-4 pb-3">
          {windows.map((w) => (
            <WindowPill
              key={w.startMinute}
              start={w.startMinute}
              end={w.endMinute}
              editing={editingStart === w.startMinute}
              disabled={disabled}
              sourceTz={sourceTz}
              selectedZones={selectedZones}
              onClick={() => setEditingStart(editingStart === w.startMinute ? null : w.startMinute)}
              onCommit={(ns, ne) => { setEditingStart(null); onUpdate(w.startMinute, ns, ne); }}
              onCancel={() => setEditingStart(null)}
              onRemove={() => { setEditingStart(null); onRemove(w.startMinute); }}
            />
          ))}
          {/* Inline + Add another — adjacent to the existing pills so the
              "you can stack multiple slots" affordance is obvious. Hidden
              while an editor is open below to avoid two competing add
              affordances. */}
          {!adding && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleAddClick}
              className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
              style={{
                borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)",
                color: "var(--primary)",
              }}
              title="Add another time slot to this day"
            >
              <Plus size={11} />
              Add another slot
            </button>
          )}
        </div>
      )}

      {/* Inline add editor — pre-fills with a suggested non-overlapping slot. */}
      {adding && addDraft && (
        <div
          className="border-t px-4 py-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--primary) 4%, transparent)",
          }}
        >
          <InlineEditor
            initialStart={addDraft.start}
            initialEnd={addDraft.end}
            onSave={(ns, ne) => { setAdding(false); setAddDraft(null); onAdd(ns, ne); }}
            onCancel={() => { setAdding(false); setAddDraft(null); }}
          />
        </div>
      )}
    </div>
  );
}

// ── Window pill — visible chip that expands into an editor inline ────────
function WindowPill({
  start, end, editing, disabled, sourceTz, selectedZones,
  onClick, onCommit, onCancel, onRemove,
}: {
  start: number;
  end: number;
  editing: boolean;
  disabled: boolean;
  sourceTz: string;
  selectedZones: TzOption[];
  onClick: () => void;
  onCommit: (newStart: number, newEnd: number) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  if (editing) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5"
        style={{
          borderColor: "var(--primary)",
          backgroundColor: "var(--surface)",
        }}
      >
        <InlineEditor
          initialStart={start}
          initialEnd={end}
          onSave={onCommit}
          onCancel={onCancel}
          onRemove={onRemove}
          compact
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="group inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{
          borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
          color: "var(--primary)",
        }}
        title="Click to edit"
      >
        <span className="size-1.5 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
        <span className="tabular-nums">{fmt12h(start)}</span>
        <span className="opacity-60">→</span>
        <span className="tabular-nums">{fmt12h(end)}</span>
      </button>
      {selectedZones.length > 0 && (
        <TzConversionLine
          start={start}
          end={end}
          sourceTz={sourceTz}
          zones={selectedZones}
        />
      )}
    </div>
  );
}

// ── Per-window timezone conversion footer ────────────────────────────────
// Shows the window in each selected target zone as compact "label start–end"
// chunks. Compresses to one line and wraps gracefully when many zones are
// picked. "(prev)" / "(next)" labels appear when the window crosses
// midnight in the target zone (very common for IST → US zones).
function TzConversionLine({
  start, end, sourceTz, zones,
}: {
  start: number;
  end: number;
  sourceTz: string;
  zones: TzOption[];
}) {
  return (
    <div
      className="ml-2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px]"
      style={{ color: "var(--text-faint)" }}
    >
      {zones.map((z) => {
        const cs = convertMinutes(start, sourceTz, z.iana);
        const ce = convertMinutes(end, sourceTz, z.iana);
        // Crossing midnight in the target zone — most common for IST → US
        // zones. "(prev day)" / "(next day)" appears on the start label so
        // the engineer reads "ok this is a graveyard shift for that customer".
        const startLabel = fmtConversion(cs);
        const endLabel = ce.mm === 0
          ? `${ce.hh12}${ce.period}`
          : `${ce.hh12}:${String(ce.mm).padStart(2, "0")}${ce.period}`;
        return (
          <span key={z.id} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="font-semibold" style={{ color: "var(--text-muted)" }}>
              {z.id}
            </span>
            <span className="tabular-nums">
              {startLabel}–{endLabel}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── Customer-zone picker bar ─────────────────────────────────────────────
function TimezonePicker({
  selectedIds, onToggle, sourceTz,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
  sourceTz: string;
}) {
  // Pre-compute current local time in each candidate zone so the picker
  // doubles as a "what time is it for them right now" cheat sheet.
  const now = new Date();
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--text) 2%, var(--surface-raised))",
      }}
    >
      <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <Globe size={11} />
        <span className="font-semibold uppercase tracking-wider">Show customer times</span>
        <span style={{ color: "var(--text-faint)" }}>· toggle the zones you serve</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TZ_OPTIONS.map((opt) => {
          const isActive = selectedIds.includes(opt.id);
          // Live "now" in this zone — tells the engineer at a glance what
          // their customer's clock reads.
          let nowLabel = "";
          try {
            nowLabel = new Intl.DateTimeFormat("en-US", {
              timeZone: opt.iana,
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }).format(now);
          } catch { /* unsupported zone — leave blank */ }
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggle(opt.id)}
              aria-pressed={isActive}
              title={`${opt.label}${nowLabel ? ` — now ${nowLabel}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: isActive ? "var(--primary)" : "var(--border)",
                backgroundColor: isActive
                  ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                  : "var(--surface)",
                color: isActive ? "var(--primary)" : "var(--text-muted)",
              }}
            >
              <span aria-hidden>{opt.flag}</span>
              <span>{opt.id}</span>
              {nowLabel && (
                <span className="opacity-60 tabular-nums" style={{ fontSize: "10px" }}>
                  {nowLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        Your local zone is <span style={{ color: "var(--text-muted)" }}>{sourceTz}</span>. Each window below shows the equivalent time in your picked zones — &ldquo;(prev)&rdquo; / &ldquo;(next)&rdquo; means it spills into the previous or next day there.
      </p>
    </div>
  );
}

// ── Inline editor — start/end time + save/cancel/(remove) ────────────────
function InlineEditor({
  initialStart, initialEnd, onSave, onCancel, onRemove, compact = false,
}: {
  initialStart: number;
  initialEnd: number;
  onSave: (start: number, end: number) => void;
  onCancel: () => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const [startStr, setStartStr] = useState(minutesToHHMM(initialStart));
  const [endStr, setEndStr] = useState(minutesToHHMM(initialEnd));

  const handleSave = () => {
    const ns = hhmmToMinutes(startStr);
    const ne = hhmmToMinutes(endStr);
    if (ns == null || ne == null || ns >= ne) return;
    onSave(ns, ne);
  };

  const inputStyle = {
    borderColor: "var(--border)",
    backgroundColor: "var(--background)",
    color: "var(--text)",
  };

  return (
    <div className={`flex items-center gap-${compact ? "1.5" : "2"}`}>
      <input
        type="time"
        value={startStr}
        autoFocus
        onChange={(e) => setStartStr(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        className="rounded-md border px-1.5 py-0.5 text-[12px] outline-none focus:border-[var(--primary)]"
        style={inputStyle}
      />
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>→</span>
      <input
        type="time"
        value={endStr}
        onChange={(e) => setEndStr(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        className="rounded-md border px-1.5 py-0.5 text-[12px] outline-none focus:border-[var(--primary)]"
        style={inputStyle}
      />
      <button
        type="button"
        onClick={handleSave}
        title="Save"
        aria-label="Save"
        className="inline-flex size-6 items-center justify-center rounded-md text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: "var(--primary)" }}
      >
        <Check size={11} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel"
        className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: "var(--text-muted)" }}
      >
        <X size={11} />
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove window"
          aria-label="Remove window"
          className="ml-1 inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]"
          style={{ color: "var(--accent-red)" }}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

function fmt12h(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 < 12 ? "am" : "pm";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

function minutesToHHMM(m: number): string {
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
function hhmmToMinutes(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

// ──────────────────────────────────────────────────────────────────────────
// Payouts tab
// ──────────────────────────────────────────────────────────────────────────
function PayoutsTab({ userId }: { userId: string }) {
  const sbRef = useRef(createClient());
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      try {
        const [sumRes, recentRes] = await Promise.all([
          sb.from("engineer_earnings_summary")
            .select("*")
            .eq("engineer_user_id", userId)
            .maybeSingle(),
          sb.from("engineer_session_history")
            .select("id, guest_name, duration_minutes, status, created_at, project_name")
            .eq("engineer_user_id", userId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        if (!alive) return;
        if (sumRes.error) throw new Error(sumRes.error.message);
        if (recentRes.error) throw new Error(recentRes.error.message);

        const s = (sumRes.data ?? null) as null | {
          total_sessions: number;
          ended_sessions: number;
          total_minutes: number;
          billable_minutes: number;
          lifetime_earnings_cents: number | null;
          most_recent_session_at: string | null;
        };
        setSummary(
          s
            ? {
                totalSessions: Number(s.total_sessions ?? 0),
                endedSessions: Number(s.ended_sessions ?? 0),
                totalMinutes: Number(s.total_minutes ?? 0),
                billableMinutes: Number(s.billable_minutes ?? 0),
                lifetimeEarningsCents: s.lifetime_earnings_cents,
                mostRecentSessionAt: s.most_recent_session_at,
              }
            : {
                totalSessions: 0,
                endedSessions: 0,
                totalMinutes: 0,
                billableMinutes: 0,
                lifetimeEarningsCents: null,
                mostRecentSessionAt: null,
              }
        );
        setRecent(
          ((recentRes.data ?? []) as Array<{
            id: string;
            guest_name: string | null;
            duration_minutes: number | null;
            status: string;
            created_at: string;
            project_name: string | null;
          }>).map((r) => ({
            id: r.id,
            guestName: r.guest_name,
            durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
            status: r.status,
            createdAt: r.created_at,
            projectName: r.project_name,
          }))
        );
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Couldn't load earnings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="size-4 animate-spin" /> Loading earnings…
      </div>
    );
  }
  if (error || !summary) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHead title="Payouts" blurb="Sessions and minutes." />
        <SectionCard>
          <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error ?? "No data."}</p>
        </SectionCard>
      </div>
    );
  }

  const lifetimeLabel = summary.lifetimeEarningsCents == null
    ? "Setup pending"
    : `$${(summary.lifetimeEarningsCents / 100).toFixed(2)}`;

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Payouts"
        blurb="Sessions, minutes, lifetime earnings. Stripe Connect payout link arrives in v2."
      />

      <div
        className="relative overflow-hidden rounded-2xl border p-6"
        style={{
          borderColor: "var(--border)",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, var(--surface-raised)) 0%, var(--surface-raised) 60%)",
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <Wallet className="size-6" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Lifetime earnings
            </div>
            <div
              className="mt-1 text-[28px] font-semibold leading-tight"
              style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
            >
              {lifetimeLabel}
            </div>
            <div className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
              {summary.lifetimeEarningsCents == null
                ? "Connect a payout method to see this populate."
                : "Lifetime credited"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Sessions" value={String(summary.totalSessions)} Icon={CalendarIcon} />
        <StatCard label="Total minutes" value={`${Math.round(summary.totalMinutes).toLocaleString()} min`} Icon={Clock} />
        <StatCard label="Billable minutes" value={`${Math.round(summary.billableMinutes).toLocaleString()} min`} Icon={TrendingUp} />
      </div>

      <SectionHead title="Recent sessions" blurb="Last 20 sessions you ran." />

      {recent.length === 0 ? (
        <SectionCard>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            No sessions yet — once you accept a call it shows up here.
          </p>
        </SectionCard>
      ) : (
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}>
          {recent.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: i === recent.length - 1 ? "none" : "1px solid var(--border)" }}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
              >
                <CalendarIcon size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                  {r.guestName ?? "Guest"}
                  {r.projectName ? <span className="ml-1 text-[11px]" style={{ color: "var(--text-muted)" }}>· {r.projectName}</span> : null}
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  <span className="lowercase">{r.status}</span>
                </div>
              </div>
              <div className="text-[12px] tabular-nums" style={{ color: "var(--text)" }}>
                {r.durationMinutes != null ? `${Math.round(r.durationMinutes)}m` : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Security tab
// ──────────────────────────────────────────────────────────────────────────
function SecurityTab({
  email, resetting, onResetPassword,
}: {
  email: string;
  resetting: boolean;
  onResetPassword: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHead title="Security" blurb="Keep your engineer account safe." />

      <SectionCard>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Password</p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              We&apos;ll email a secure link to {email || "your address"} to set a new one.
            </p>
          </div>
          <Button
            variant="secondary"
            iconLeft={<KeyRound className="size-4" />}
            loading={resetting}
            onClick={onResetPassword}
          >
            Reset password
          </Button>
        </div>
      </SectionCard>

      <SectionCard variant="muted">
        <ComingSoonRow
          title="Two-factor authentication"
          body="Add a second step at sign-in via TOTP authenticator app."
        />
      </SectionCard>

      <SectionCard variant="muted">
        <ComingSoonRow
          title="Active sessions"
          body="See every device signed in. Sign out remotely from here."
        />
      </SectionCard>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Notifications tab
// ──────────────────────────────────────────────────────────────────────────
function NotificationsTab({
  emailEnabled, emailSaving, onToggleEmail,
}: {
  emailEnabled: boolean;
  emailSaving: boolean;
  onToggleEmail: (next: boolean) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const desktopInstalled = typeof window !== "undefined" && Boolean((window as any).__RELAY_DESKTOP__);

  return (
    <div className="flex flex-col gap-6">
      <SectionHead title="Notifications" blurb="How we ping you about sessions and payouts." />

      <SectionCard>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <Mail className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Email notifications</p>
              <StatusPill on={emailEnabled} />
            </div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Session assignments, payout notifications, account safety messages. On by default
              per the{" "}
              <a href="/legal/terms-of-use" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: "var(--text-muted)" }}>Terms</a>
              {" "}and{" "}
              <a href="/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: "var(--text-muted)" }}>Privacy Policy</a>
              {" "}— flip it off here any time.
            </p>
            <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
              Account-critical security mail (password resets, suspicious sign-in) still comes through.
            </p>
          </div>
          <Toggle
            checked={emailEnabled}
            disabled={emailSaving}
            onChange={onToggleEmail}
            ariaLabel="Toggle email notifications"
          />
        </div>
      </SectionCard>

      <SectionCard>
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <BellRing className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                In-app &amp; system notifications
              </p>
              {desktopInstalled ? (
                <StatusPill on label="Installed" />
              ) : (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
                    color: "var(--text-muted)",
                  }}
                >
                  Desktop only
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {desktopInstalled
                ? "OS-level pings for incoming calls + new connect requests, even when the browser tab is closed."
                : "Get OS-level pings for incoming calls, new connect requests, and reminders. Available exclusively through the Relay desktop app."}
            </p>
            {!desktopInstalled && (
              <a
                href="/download-relay-desktop"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-90"
                style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
              >
                <DownloadIcon className="size-3.5" />
                Download Relay desktop
              </a>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard variant="muted">
        <div className="flex items-start gap-4">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
              color: "var(--text-muted)",
            }}
          >
            <Monitor className="size-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>In-room toasts</p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              Banner alerts that show up while you&apos;re actively in a session — always on while
              you&apos;re on Relay.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Building blocks
// ──────────────────────────────────────────────────────────────────────────
function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2
        className="text-[20px] font-semibold tracking-tight"
        style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
      >
        {title}
      </h2>
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>{blurb}</p>
    </div>
  );
}

function SectionCard({
  children, variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "muted";
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: "var(--border)",
        backgroundColor: variant === "muted"
          ? "color-mix(in srgb, var(--surface-raised) 60%, transparent)"
          : "var(--surface-raised)",
      }}
    >
      {children}
    </div>
  );
}

function StatCard({ label, value, Icon }: { label: string; value: string; Icon: typeof Clock }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        <Icon size={11} />
        {label}
      </div>
      <div
        className="mt-1.5 text-[20px] font-semibold leading-tight"
        style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
      >
        {value}
      </div>
    </div>
  );
}

function Toggle({
  checked, disabled, onChange, ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        backgroundColor: checked
          ? "var(--primary)"
          : "color-mix(in srgb, var(--text) 15%, transparent)",
      }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function StatusPill({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{
        backgroundColor: on
          ? "color-mix(in srgb, var(--primary) 14%, transparent)"
          : "color-mix(in srgb, var(--text) 8%, transparent)",
        color: on ? "var(--primary)" : "var(--text-muted)",
      }}
    >
      {on ? <Check size={9} /> : null}
      {label ?? (on ? "On" : "Off")}
    </span>
  );
}

function ComingSoonRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        <ChevronRight className="size-4" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{title}</p>
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
              color: "var(--text-muted)",
            }}
          >
            Soon
          </span>
        </div>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>{body}</p>
      </div>
    </div>
  );
}
