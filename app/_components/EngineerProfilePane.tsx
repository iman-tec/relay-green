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
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";
import {
  Bell, BellRing, Calendar as CalendarIcon, Check, CheckCircle2, ChevronRight,
  Clock, Copy, CreditCard, Download as DownloadIcon, Globe, Home, KeyRound, Loader2, Mail,
  Monitor, Plus, ShieldCheck, Sparkles, Trash2,
  TrendingUp, User, Wallet, Wrench, X, Zap,
} from "lucide-react";
import { Button, Toast, cn } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";
import {
  listMyDevices, revokeDevice, getOrCreateFingerprint, type UserDevice,
} from "@/lib/relay/deviceTracking";

// ── Tab identity ──────────────────────────────────────────────────────────
// Calendar moved to its own top-level sidebar destination (/calendar) so
// it stops being buried in the deep profile-pane tab list.
export type EngineerTab =
  | "profile"
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
  // Customer-aligned axes — added in 20260527200000. Optional because
  // existing engineers won't have these populated until re-onboarding.
  projectTypes: string[];
  aiTools: string[];
  backendStacks: string[];
  frontendStacks: string[];
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
  // Set when this block came from a pod-wide holiday (Super-Admin). Such rows
  // are read-only to the engineer/supervisor — they can't delete them.
  podId?: string | null;
};

// ── Earnings shape ────────────────────────────────────────────────────────
type ContractType = "build" | "golive" | "maintain";
const CONTRACT_TYPES: readonly ContractType[] = ["build", "golive", "maintain"] as const;

type ContractRollup = {
  contractType: ContractType;
  paidSessions: number;
  totalSessions: number;
  totalMinutes: number;
  billableMinutes: number;
  distinctProjects: number;
};

type RecentSession = {
  id: string;
  guestName: string | null;
  durationMinutes: number | null;
  status: string;
  createdAt: string;
  projectName: string | null;
  projectId: string | null;
  contractType: ContractType | null;
  paidExtensionAt: string | null;
};

type DateRangePresetId = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

type DateRange = {
  presetId: DateRangePresetId;
  from: string | null;   // ISO yyyy-mm-dd; null = no lower bound
  to: string | null;     // ISO yyyy-mm-dd; null = no upper bound
};

function rangeFromPreset(id: Exclude<DateRangePresetId, "custom">): DateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (id === "all") return { presetId: "all", from: null, to: null };
  if (id === "ytd") {
    return { presetId: "ytd", from: `${today.getFullYear()}-01-01`, to: iso(today) };
  }
  const days = id === "7d" ? 7 : id === "30d" ? 30 : 90;
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { presetId: id, from: iso(from), to: iso(today) };
}

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
          "user_id, display_alias, expertise, technologies, experience_level, is_available, presence_state, email_notifications_enabled, project_types, ai_tools, backend_stacks, frontend_stacks"
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
          projectTypes: [],
          aiTools: [],
          backendStacks: [],
          frontendStacks: [],
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
          // New customer-aligned axes — nullable because old rows may
          // not have them populated until the engineer re-onboards.
          project_types: string[] | null;
          ai_tools: string[] | null;
          backend_stacks: string[] | null;
          frontend_stacks: string[] | null;
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
          projectTypes: row.project_types ?? [],
          aiTools: row.ai_tools ?? [],
          backendStacks: row.backend_stacks ?? [],
          frontendStacks: row.frontend_stacks ?? [],
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

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
              />
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
  profile, email,
}: {
  profile: EngineerProfile;
  email: string;
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

      {/* Presence picker moved to the Dashboard — engineers flip presence
          from the top-right pill or the dashboard's Presence card, not
          from deep in the profile pane. */}

      <SectionHead
        title="Expertise"
        blurb="What you onboarded with. The customer-aligned axes are what the matcher scores against."
      />

      <SectionCard>
        <div className="flex flex-col gap-4">
          {/* High-level expertise area + experience level — your own
              self-declared category, separate from the customer-axis
              capabilities below. */}
          <ReadOnlyChips label="Expertise areas" values={profile.expertise} />
          {profile.experienceLevel && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
              <span style={{ color: "var(--text-faint)" }}>Experience level:</span>
              <span style={{ color: "var(--text)" }}>{profile.experienceLevel}</span>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Customer-aligned axes — these four match the exact options
          customers pick from when starting a new project, so the
          matcher can score capability overlap directly. Empty arrays
          mean the engineer hasn't re-onboarded since these fields were
          added — surface that gently. */}
      <SectionCard>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--primary)" }}>
            Customer-brief alignment
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            · same options customers pick from
          </span>
        </div>
        <div className="flex flex-col gap-4">
          <ReadOnlyChips label="Project types you support" values={profile.projectTypes} />
          <ReadOnlyChips label="AI tools you've worked with" values={profile.aiTools} />
          <ReadOnlyChips label="Backend / infra" values={profile.backendStacks} />
          <ReadOnlyChips label="Frontend / UI" values={profile.frontendStacks} />
          {(profile.projectTypes.length + profile.aiTools.length + profile.backendStacks.length + profile.frontendStacks.length === 0) && (
            <p className="rounded-md border px-3 py-2 text-[11px]" style={{
              borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--warn) 5%, transparent)",
              color: "var(--text-muted)",
            }}>
              These four axes are new — your profile predates them. Re-run engineer onboarding to populate them so the matcher can route the right work to you.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard>
        <div className="flex flex-col gap-3">
          {/* Legacy technologies array — auto-populated from backend +
              frontend on re-onboard. Hidden when empty so the engineer
              isn't confronted with a dead section. */}
          {profile.technologies.length > 0 && (
            <ReadOnlyChips label="Technologies (legacy)" values={profile.technologies} />
          )}
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            To change any of these, run through engineer onboarding again — or ask a supervisor to override.
          </p>
        </div>
      </SectionCard>
    </div>
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

// Exported so the new /calendar route can mount it standalone. The
// internal helpers (MonthView, DateSlotsPopup, HolidaysSection, etc.)
// stay file-local — only the entry point needs to be addressable.
export function CalendarTab({
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
          selectedZones={selectedZones}
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

type DateWindow = {
  date: string;          // ISO yyyy-mm-dd
  startMinute: number;
  endMinute: number;
};

function MonthView({
  userId, windows, sourceTz, selectedZones,
}: {
  userId: string;
  windows: AvailabilityWindow[];
  sourceTz: string;
  selectedZones: TzOption[];
}) {
  const sbRef = useRef(createClient());
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [holidaysAll, setHolidaysAll] = useState<EngineerHoliday[]>([]);
  const [bookings, setBookings] = useState<MonthBooking[]>([]);
  const [dateWindows, setDateWindows] = useState<DateWindow[]>([]);
  const [popupDate, setPopupDate] = useState<string | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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
      // engineer_date_windows is best-effort — the table is added in a
      // later migration and may not be applied on this environment yet.
      // We catch the 4xx silently so the calendar still renders, just
      // without override badges.
      const [hRes, bRes, dwRes] = await Promise.all([
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
        sb.from("engineer_date_windows")
          .select("the_date, start_minute, end_minute")
          .eq("engineer_user_id", userId)
          .gte("the_date", fromKey.toISOString().slice(0, 10))
          .lte("the_date", toKey.toISOString().slice(0, 10)),
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
      // date_windows may 404 if the migration isn't applied — degrade
      // silently to "no overrides anywhere."
      if (!dwRes.error) {
        const dwRows = (dwRes.data ?? []) as Array<{ the_date: string; start_minute: number; end_minute: number }>;
        setDateWindows(dwRows.map((r) => ({
          date: r.the_date, startMinute: r.start_minute, endMinute: r.end_minute,
        })));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Re-fetch date_windows after a popup save — keeps the override badges
  // in sync without a full page reload.
  const refreshDateWindows = useCallback(async () => {
    const sb = sbRef.current;
    const fromKey = new Date();
    fromKey.setHours(0, 0, 0, 0);
    const toKey = new Date(fromKey);
    toKey.setFullYear(toKey.getFullYear() + 1);
    const { data, error } = await sb
      .from("engineer_date_windows")
      .select("the_date, start_minute, end_minute")
      .eq("engineer_user_id", userId)
      .gte("the_date", fromKey.toISOString().slice(0, 10))
      .lte("the_date", toKey.toISOString().slice(0, 10));
    if (error) return;
    setDateWindows(((data ?? []) as Array<{ the_date: string; start_minute: number; end_minute: number }>).map((r) => ({
      date: r.the_date, startMinute: r.start_minute, endMinute: r.end_minute,
    })));
  }, [userId]);

  const refreshHolidays = useCallback(async () => {
    const sb = sbRef.current;
    const fromKey = new Date();
    fromKey.setHours(0, 0, 0, 0);
    const toKey = new Date(fromKey);
    toKey.setFullYear(toKey.getFullYear() + 1);
    const { data, error } = await sb
      .from("engineer_holidays")
      .select("holiday_date, label, kind")
      .eq("engineer_user_id", userId)
      .gte("holiday_date", fromKey.toISOString().slice(0, 10))
      .lte("holiday_date", toKey.toISOString().slice(0, 10));
    if (error) return;
    setHolidaysAll(((data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string }>).map((r) => ({
      date: r.holiday_date,
      label: r.label,
      kind: (["holiday", "vacation", "sick", "personal", "other"].includes(r.kind)
        ? r.kind : "holiday") as EngineerHoliday["kind"],
    })));
  }, [userId]);

  // Computed lookups so the cell renderer stays O(1).
  const holidayByDate = useMemo(() => {
    const m = new Map<string, EngineerHoliday>();
    for (const h of holidaysAll) m.set(h.date, h);
    return m;
  }, [holidaysAll]);

  // date → date_windows[] map. Cells with a non-empty entry are
  // "custom" — they diverge from the recurring weekly pattern.
  const dateWindowsByDate = useMemo(() => {
    const m = new Map<string, DateWindow[]>();
    for (const dw of dateWindows) {
      const arr = m.get(dw.date) ?? [];
      arr.push(dw);
      m.set(dw.date, arr);
    }
    return m;
  }, [dateWindows]);

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
    // Open the popup for today so the engineer can immediately edit slots
    // — same UX as clicking the today cell in non-multi-select mode.
    if (!multiSelect) {
      setPopupDate(isoDateInTz(today, sourceTz));
    }
  };

  // Per-cell render helpers. Resolution order (matches the customer-side
  // ScheduleEngineerModal): holiday → date_windows → weekly pattern.
  const cellMinutes = (date: Date): number => {
    if (date.getMonth() !== cursor.month) return 0; // grey out non-month cells
    const dayKey = isoDateInTz(date, sourceTz);
    if (holidayByDate.has(dayKey)) return 0;
    const overrides = dateWindowsByDate.get(dayKey);
    if (overrides && overrides.length > 0) {
      return overrides.reduce((s, w) => s + (w.endMinute - w.startMinute), 0);
    }
    return minutesPerWeekday[date.getDay()];
  };

  // Cell-click behaviour depends on mode. Single-mode opens the popup
  // editor for that date; multi-select mode toggles membership in the
  // selectedDates set so the engineer can batch-apply a template.
  const handleCellClick = (date: Date) => {
    if (date.getMonth() !== cursor.month) return;
    const dayKey = isoDateInTz(date, sourceTz);
    if (multiSelect) {
      setSelectedDates((prev) => {
        const next = new Set(prev);
        if (next.has(dayKey)) next.delete(dayKey);
        else next.add(dayKey);
        return next;
      });
    } else {
      setPopupDate(dayKey);
    }
  };

  // Bulk operations — fan out the set of selected dates through the
  // dedicated bulk RPCs so the network cost stays one round-trip
  // regardless of how many dates the engineer ticked.
  const applyBulkTemplate = useCallback(async (slots: Array<[number, number]>) => {
    if (bulkBusy || selectedDates.size === 0) return;
    setBulkBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("apply_date_template_bulk", {
        _dates: Array.from(selectedDates),
        _slots: slots.map(([s, e]) => ({ start_minute: s, end_minute: e })),
      });
      if (error) throw new Error(error.message);
      await refreshDateWindows();
      setSelectedDates(new Set());
      setMultiSelect(false);
    } catch (err) {
      console.warn("[month-view] bulk template failed:", err);
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, selectedDates, refreshDateWindows]);

  const bulkBlockDates = useCallback(async () => {
    if (bulkBusy || selectedDates.size === 0) return;
    setBulkBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("add_engineer_holidays_bulk", {
        _rows: Array.from(selectedDates).map((d) => ({ date: d, label: null, kind: "personal" })),
      });
      if (error) throw new Error(error.message);
      await refreshHolidays();
      setSelectedDates(new Set());
      setMultiSelect(false);
    } catch (err) {
      console.warn("[month-view] bulk block failed:", err);
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, selectedDates, refreshHolidays]);

  const bulkResetDates = useCallback(async () => {
    if (bulkBusy || selectedDates.size === 0) return;
    setBulkBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("clear_date_overrides_bulk", {
        _dates: Array.from(selectedDates),
      });
      if (error) throw new Error(error.message);
      await refreshDateWindows();
      setSelectedDates(new Set());
      setMultiSelect(false);
    } catch (err) {
      console.warn("[month-view] bulk reset failed:", err);
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, selectedDates, refreshDateWindows]);

  const popupDateWindows = popupDate ? (dateWindowsByDate.get(popupDate) ?? []) : [];
  const popupHoliday = popupDate ? holidayByDate.get(popupDate) : undefined;

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
        <div className="flex items-center gap-1.5">
          {/* Multi-select toggle — flips the grid into batch mode where
              clicking dates accumulates them into the selectedDates set
              and a bottom action bar offers bulk Apply / Block / Reset
              operations through the dedicated jsonb RPCs. */}
          <button
            type="button"
            onClick={() => {
              setMultiSelect((v) => !v);
              if (multiSelect) setSelectedDates(new Set());
            }}
            aria-pressed={multiSelect}
            title={multiSelect ? "Exit select-multiple" : "Select multiple dates"}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              borderColor: multiSelect ? "var(--primary)" : "var(--border)",
              backgroundColor: multiSelect ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
              color: multiSelect ? "var(--primary)" : "var(--text-muted)",
            }}
          >
            {multiSelect ? "Selecting…" : "Select multiple"}
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)]"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Today
          </button>
        </div>
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
              const isMultiPicked = multiSelect && selectedDates.has(dayKey);
              const holiday = holidayByDate.get(dayKey);
              const bks = bookingsByDate.get(dayKey) ?? [];
              const projMin = inMonth ? cellMinutes(d) : 0;
              const projHours = Math.floor(projMin / 60);
              const projRem = projMin % 60;
              const isPast = d.getTime() < today.getTime();
              const hasOverride = (dateWindowsByDate.get(dayKey) ?? []).length > 0;
              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => handleCellClick(d)}
                  className="relative flex min-h-[68px] flex-col items-start gap-1 border-b border-r p-1.5 text-left transition-colors last:border-r-0 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: isMultiPicked
                      ? "color-mix(in srgb, var(--primary) 18%, transparent)"
                      : "transparent",
                    opacity: !inMonth ? 0.35 : isPast ? 0.55 : 1,
                    boxShadow: isMultiPicked
                      ? "inset 0 0 0 2px var(--primary)"
                      : "none",
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
                  {/* "Custom" override badge — appears when the date has
                      its own engineer_date_windows rows replacing the
                      weekly pattern for just this date. Top-right corner
                      so it doesn't compete with the hour badge / Today
                      marker. */}
                  {hasOverride && inMonth && !holiday && (
                    <span
                      aria-hidden
                      className="absolute right-1 top-1 inline-flex h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: "#a855f7" }}
                      title="Custom slots for this date"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
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
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: "#a855f7" }} />
          Custom slots (differs from weekly pattern)
        </span>
      </div>

      {/* Multi-select action bar — appears at the bottom only when the
          engineer is in select-multiple mode and has at least one date
          picked. Bulk operations fan out via the dedicated jsonb RPCs. */}
      {multiSelect && selectedDates.size > 0 && (
        <div
          className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border p-3 shadow-lg"
          style={{
            borderColor: "var(--primary)",
            backgroundColor: "color-mix(in srgb, var(--primary) 10%, var(--surface))",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          <span className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>
            {selectedDates.size} date{selectedDates.size === 1 ? "" : "s"} selected
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void applyBulkTemplate([[9 * 60, 17 * 60]])}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            9am–5pm
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void applyBulkTemplate([[9 * 60, 13 * 60]])}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Mornings (9–1)
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void applyBulkTemplate([[18 * 60, 22 * 60]])}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Evenings (6–10)
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void bulkBlockDates()}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-red) 40%, transparent)",
              color: "var(--accent-red)",
            }}
          >
            Block all
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void bulkResetDates()}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            Reset to pattern
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => {
              setSelectedDates(new Set());
              setMultiSelect(false);
            }}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Per-date editor popup — replaces the inline detail panel. Lets
          the engineer set custom slots for a specific date, reset to the
          weekly pattern, or block the date entirely. */}
      {popupDate && (
        <DateSlotsPopup
          date={popupDate}
          weeklyWindows={windows}
          dateOverrides={popupDateWindows}
          holiday={popupHoliday ?? null}
          bookingsToday={bookingsByDate.get(popupDate) ?? []}
          sourceTz={sourceTz}
          selectedZones={selectedZones}
          onClose={() => setPopupDate(null)}
          onAnyChange={async () => {
            await Promise.all([refreshDateWindows(), refreshHolidays()]);
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DateSlotsPopup — edits a single date's availability. Pre-fills from the
// weekly pattern (per UX preference) when no overrides exist; saving any
// slots creates engineer_date_windows rows that REPLACE the pattern for
// that date. Reset-to-pattern wipes the overrides; Block-this-date adds
// a holiday row.
// ──────────────────────────────────────────────────────────────────────────
function DateSlotsPopup({
  date, weeklyWindows, dateOverrides, holiday, bookingsToday,
  sourceTz, selectedZones, onClose, onAnyChange,
}: {
  date: string;
  weeklyWindows: AvailabilityWindow[];
  dateOverrides: DateWindow[];
  holiday: EngineerHoliday | null;
  bookingsToday: MonthBooking[];
  sourceTz: string;
  selectedZones: TzOption[];
  onClose: () => void;
  onAnyChange: () => Promise<void> | void;
}) {
  const sbRef = useRef(createClient());
  const dialogRef = useOverlayDismiss<HTMLDivElement>(onClose);
  const dateObj = new Date(`${date}T12:00:00`);
  const weekday = dateObj.getDay();
  const dayWeeklyWindows = weeklyWindows
    .filter((w) => w.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
  const hasOverrides = dateOverrides.length > 0;

  // Editor state — pre-filled from overrides if any, else from the weekly
  // pattern for this weekday (per the chosen UX). Each slot is a tuple
  // [startMin, endMin]; the editor renders one row per tuple.
  type SlotDraft = { start: number; end: number };
  const initialSlots: SlotDraft[] = hasOverrides
    ? dateOverrides.map((d) => ({ start: d.startMinute, end: d.endMinute }))
    : dayWeeklyWindows.map((w) => ({ start: w.startMinute, end: w.endMinute }));
  const [slots, setSlots] = useState<SlotDraft[]>(initialSlots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedSlots = useMemo(
    () => [...slots].sort((a, b) => a.start - b.start),
    [slots],
  );

  const addSlot = () => {
    // Find next non-overlapping slot.
    const lastEnd = slots.reduce((m, s) => Math.max(m, s.end), 0);
    const start = Math.min(lastEnd > 0 ? lastEnd + 60 : 9 * 60, 21 * 60);
    setSlots([...slots, { start, end: Math.min(start + 120, 23 * 60) }]);
  };
  const updateSlot = (i: number, patch: Partial<SlotDraft>) => {
    setSlots(slots.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };
  const removeSlot = (i: number) => {
    setSlots(slots.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = sbRef.current;
      // Validate
      for (const s of slots) {
        if (s.start >= s.end) throw new Error("Each slot's end must be after its start.");
        if (s.start < 0 || s.end > 1440) throw new Error("Slots must be within a single day.");
      }
      const { error: rpcErr } = await sb.rpc("apply_date_template_bulk", {
        _dates: [date],
        _slots: slots.map((s) => ({ start_minute: s.start, end_minute: s.end })),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      await onAnyChange();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save slots.");
    } finally {
      setBusy(false);
    }
  };

  const handleResetToPattern = async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = sbRef.current;
      const { error: rpcErr } = await sb.rpc("clear_date_overrides", { _date: date });
      if (rpcErr) throw new Error(rpcErr.message);
      await onAnyChange();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleHoliday = async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = sbRef.current;
      if (holiday) {
        const { error: rpcErr } = await sb.rpc("remove_engineer_holiday", { _date: date });
        if (rpcErr) throw new Error(rpcErr.message);
      } else {
        const { error: rpcErr } = await sb.rpc("add_engineer_holiday", {
          _date: date, _label: null, _kind: "personal",
        });
        if (rpcErr) throw new Error(rpcErr.message);
      }
      await onAnyChange();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update holiday.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", maxHeight: "85vh" }}
      >
        {/* Header */}
        <header
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--primary) 6%, transparent)",
          }}
        >
          <CalendarIcon size={16} style={{ color: "var(--primary)" }} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              {dateObj.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </h2>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {holiday
                ? `Off · ${holiday.label ?? holiday.kind}`
                : hasOverrides
                  ? "Custom slots for this date (overrides weekly pattern)"
                  : `Inherits from your weekly ${WEEKDAYS[weekday]} pattern`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </header>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: "calc(85vh - 120px)" }}>
          {holiday ? (
            <div
              className="flex items-start gap-3 rounded-lg border p-3"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 40%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--accent-red) 6%, transparent)",
              }}
            >
              <Trash2 size={14} style={{ color: "var(--accent-red)" }} className="mt-0.5 shrink-0" />
              <div className="flex-1 text-[12px]" style={{ color: "var(--text)" }}>
                This date is blocked. Customers can&apos;t book any slot, even if the weekly pattern would normally allow it.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Slots for this date
                </h3>
                <div className="flex flex-col gap-2">
                  {slots.length === 0 ? (
                    <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>
                      No slots. Customers will see this day as unavailable. Add one, or hit &ldquo;Reset to pattern&rdquo; below.
                    </p>
                  ) : (
                    sortedSlots.map((s) => {
                      // Find the original index in the unsorted slots list
                      // so update/remove targets the right entry.
                      const originalIndex = slots.findIndex(
                        (x) => x.start === s.start && x.end === s.end,
                      );
                      return (
                        <SlotEditorRow
                          key={`${s.start}-${s.end}-${originalIndex}`}
                          slot={s}
                          disabled={busy}
                          sourceTz={sourceTz}
                          selectedZones={selectedZones}
                          onChange={(patch) => updateSlot(originalIndex, patch)}
                          onRemove={() => removeSlot(originalIndex)}
                        />
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={addSlot}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--primary-soft)] disabled:opacity-50"
                  style={{
                    borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)",
                    color: "var(--primary)",
                  }}
                >
                  <Plus size={11} />
                  Add another slot
                </button>
              </div>

              {/* Reference: weekly pattern for this weekday */}
              {!hasOverrides && dayWeeklyWindows.length > 0 && (
                <div className="rounded-lg border p-3" style={{
                  borderColor: "var(--border)",
                  backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
                }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    Your normal {WEEKDAYS[weekday]}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {dayWeeklyWindows.map((w) => (
                      <span
                        key={w.startMinute}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {fmt12h(w.startMinute)} → {fmt12h(w.endMinute)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Bookings on this date — informational */}
              {bookingsToday.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    Customer bookings on this date
                  </h3>
                  <div className="flex flex-col gap-1">
                    {bookingsToday.map((b) => (
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
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 text-[12px]" style={{ color: "var(--accent-red)" }}>{error}</p>
          )}
        </div>

        {/* Footer actions */}
        <footer
          className="flex flex-wrap items-center gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
        >
          {!holiday && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleResetToPattern()}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                Reset to weekly pattern
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleToggleHoliday()}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-red) 40%, transparent)",
                  color: "var(--accent-red)",
                }}
              >
                Block this date
              </button>
            </>
          )}
          {holiday && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleToggleHoliday()}
              className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Unblock this date
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Cancel
          </button>
          {!holiday && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="rounded-md px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--primary)" }}
            >
              {busy ? <Loader2 size={11} className="inline animate-spin" /> : <Check size={11} className="inline" />}
              {" "}Save
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function SlotEditorRow({
  slot, disabled, sourceTz, selectedZones, onChange, onRemove,
}: {
  slot: { start: number; end: number };
  disabled: boolean;
  sourceTz: string;
  selectedZones: TzOption[];
  onChange: (patch: Partial<{ start: number; end: number }>) => void;
  onRemove: () => void;
}) {
  const [startStr, setStartStr] = useState(minutesToHHMM(slot.start));
  const [endStr, setEndStr] = useState(minutesToHHMM(slot.end));
  useEffect(() => { setStartStr(minutesToHHMM(slot.start)); }, [slot.start]);
  useEffect(() => { setEndStr(minutesToHHMM(slot.end)); }, [slot.end]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={startStr}
          disabled={disabled}
          onChange={(e) => {
            setStartStr(e.target.value);
            const m = hhmmToMinutes(e.target.value);
            if (m != null) onChange({ start: m });
          }}
          className="rounded-md border px-2 py-1 text-[12px] outline-none"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
        />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>→</span>
        <input
          type="time"
          value={endStr}
          disabled={disabled}
          onChange={(e) => {
            setEndStr(e.target.value);
            const m = hhmmToMinutes(e.target.value);
            if (m != null) onChange({ end: m });
          }}
          className="rounded-md border px-2 py-1 text-[12px] outline-none"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          title="Remove slot"
          aria-label="Remove slot"
          className="ml-auto inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
          style={{ color: "var(--text-muted)" }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {selectedZones.length > 0 && (
        <TzConversionLine
          start={slot.start}
          end={slot.end}
          sourceTz={sourceTz}
          zones={selectedZones}
        />
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
type LeaveRequest = {
  id: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  kind: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  createdAt: string;
};

function HolidaysSection({
  userId, showBanner,
}: {
  userId: string;
  showBanner: (b: NonNullable<Banner>) => void;
}) {
  const sbRef = useRef(createClient());
  const [holidays, setHolidays] = useState<EngineerHoliday[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Viewer role decides who signs off (Supervisor for engineers, SuperAdmin
  // for supervisors) — shown in the acknowledgement note.
  const [viewerRole, setViewerRole] = useState<"engineer" | "supervisor">("engineer");
  const approver = viewerRole === "supervisor" ? "SuperAdmin" : "Supervisor";

  // ── Request Form state ─────────────────────────────────────────────────
  const [reqFrom, setReqFrom] = useState("");
  const [reqTo, setReqTo] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [ack, setAck] = useState(false);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const totalDays = useMemo(() => {
    if (!reqFrom || !reqTo) return 0;
    const a = new Date(`${reqFrom}T00:00:00`).getTime();
    const b = new Date(`${reqTo}T00:00:00`).getTime();
    if (b < a) return 0;
    return Math.round((b - a) / 86_400_000) + 1;
  }, [reqFrom, reqTo]);

  const inputStyle = { borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" } as const;

  const loadHolidays = useCallback(async () => {
    const sb = sbRef.current;
    const { data, error } = await sb
      .from("engineer_holidays")
      .select("holiday_date, label, kind, pod_id")
      .eq("engineer_user_id", userId)
      .order("holiday_date", { ascending: true });
    if (error) { showBanner({ tone: "risk", text: error.message }); return; }
    setHolidays(
      ((data ?? []) as Array<{ holiday_date: string; label: string | null; kind: string; pod_id: string | null }>).map((r) => ({
        date: r.holiday_date,
        label: r.label,
        kind: (["holiday", "vacation", "sick", "personal", "other"].includes(r.kind)
          ? r.kind : "holiday") as EngineerHoliday["kind"],
        podId: r.pod_id,
      }))
    );
  }, [userId, showBanner]);

  const loadRequests = useCallback(async () => {
    const sb = sbRef.current;
    const { data, error } = await sb
      .from("leave_requests")
      .select("id, start_date, end_date, total_days, reason, kind, status, rejection_reason, created_at")
      .eq("requester_user_id", userId)
      .order("created_at", { ascending: false });
    if (error) return; // brand-new table / RLS hiccup — don't nag the user
    setRequests(
      ((data ?? []) as Array<{ id: string; start_date: string; end_date: string; total_days: number; reason: string; kind: string; status: string; rejection_reason: string | null; created_at: string }>).map((r) => ({
        id: r.id, startDate: r.start_date, endDate: r.end_date, totalDays: r.total_days,
        reason: r.reason, kind: r.kind,
        status: (["pending", "approved", "rejected"].includes(r.status) ? r.status : "pending") as LeaveRequest["status"],
        rejectionReason: r.rejection_reason, createdAt: r.created_at,
      }))
    );
  }, [userId]);

  // Initial load: role + holidays + own requests.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      setLoading(true);
      const { data: roleRows } = await sb.from("user_role_names").select("role").eq("user_id", userId);
      if (!alive) return;
      const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
      setViewerRole(roles.includes("supervisor") && !roles.includes("engineer") ? "supervisor" : "engineer");
      await Promise.all([loadHolidays(), loadRequests()]);
      if (!alive) return;
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, loadHolidays, loadRequests]);

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

  const submitRequest = async () => {
    if (busy) return;
    if (!reqFrom || !reqTo) { showBanner({ tone: "risk", text: "Pick both start and end dates." }); return; }
    if (reqTo < reqFrom) { showBanner({ tone: "risk", text: "End date must be on or after start date." }); return; }
    if (!reqReason.trim()) { showBanner({ tone: "risk", text: "Please specify a reason for the leave." }); return; }
    if (!ack) { showBanner({ tone: "risk", text: "Please tick the acknowledgement before applying." }); return; }
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("submit_leave_request", {
        _start: reqFrom, _end: reqTo, _reason: reqReason.trim(), _kind: "vacation",
      });
      if (error) throw new Error(error.message);
      setReqFrom(""); setReqTo(""); setReqReason(""); setAck(false);
      await loadRequests();
      showBanner({ tone: "ok", text: `Leave request submitted — awaiting ${approver} approval.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't submit the request.";
      showBanner({ tone: "risk", text: /DATE_IN_PAST/.test(msg) ? "Leave can only be requested for today or a future date." : msg });
    } finally {
      setBusy(false);
    }
  };

  const deleteRequest = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("delete_leave_request", { _id: id });
      if (error) throw new Error(error.message);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't delete the request." });
    } finally {
      setBusy(false);
    }
  };

  // Accepted leave is shown only once — as a blocked date below. Here we keep
  // just what's still in play: pending (awaiting a decision) and rejected.
  const visibleRequests = useMemo(
    () => requests.filter((r) => r.status === "pending" || r.status === "rejected"),
    [requests],
  );

  // Group blocked dates by month for the list. Pod-wide holidays (set by the
  // Super-Admin) are excluded here — they're read-only and already render on
  // the month calendar above; listing them here just adds undeletable clutter.
  const groups = useMemo(() => {
    const map = new Map<string, EngineerHoliday[]>();
    for (const h of holidays) {
      if (h.podId) continue; // pod holiday — calendar-only
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
        blurb={`Request leave below. Nothing is blocked on your calendar until your ${approver} approves it.`}
      />

      {/* ── Request Form ──────────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-3 rounded-xl border p-4"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Request Form
        </span>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            From
            <input type="date" min={todayStr} value={reqFrom} onChange={(e) => setReqFrom(e.target.value)}
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
              className="cursor-pointer rounded-md border px-2 py-1 text-[12px] outline-none" style={inputStyle} />
          </label>
          <span className="pb-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>→</span>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            To
            <input type="date" min={reqFrom || todayStr} value={reqTo} onChange={(e) => setReqTo(e.target.value)}
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
              className="cursor-pointer rounded-md border px-2 py-1 text-[12px] outline-none" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Total days
            <div className="flex h-[30px] min-w-[64px] items-center rounded-md border px-2 text-[12px] tabular-nums"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: totalDays ? "var(--text)" : "var(--text-faint)" }}>
              {totalDays || "—"}
            </div>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>Reason <span style={{ color: "var(--risk)" }}>*</span></span>
          <textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} rows={3}
            placeholder="Please specify reason for leave in detail."
            className="resize-y rounded-md border px-2 py-1.5 text-[12px] outline-none" style={inputStyle} />
        </label>

        <label className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 shrink-0" />
          <span>
            Please make sure to obtain approval from your {approver} before
            taking any leave. Leaves arrangements that are not approved in advance may be considered unauthorized.
          </span>
        </label>

        <div className="flex justify-end">
          <Button variant="primary" size="sm" iconLeft={<Plus className="size-3.5" />}
            loading={busy} disabled={!ack || !reqReason.trim()} onClick={() => void submitRequest()}>
            Apply
          </Button>
        </div>
      </div>

      {/* ── Your leave requests (pending / rejected) ──────────────────── */}
      {visibleRequests.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Your leave requests
          </span>
          {visibleRequests.map((r) => (
            <LeaveRequestRow key={r.id} req={r} disabled={busy} onDelete={() => void deleteRequest(r.id)} />
          ))}
        </div>
      )}

      {/* ── Blocked dates (approved leave + holidays) ─────────────────── */}
      {loading ? (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      ) : groups.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>
          No blocked dates yet. Your full weekly availability applies.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Blocked dates
          </span>
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

function LeaveRequestRow({
  req, disabled, onDelete,
}: {
  req: LeaveRequest;
  disabled: boolean;
  onDelete: () => void;
}) {
  const rejected = req.status === "rejected";
  const approved = req.status === "approved";
  // Approved leave is locked in (and blocks the calendar) — only pending /
  // rejected requests can be deleted by the requester.
  const deletable = !approved;
  const statusColor = rejected ? "var(--risk)" : approved ? "var(--ok)" : "var(--warn)";
  const statusLabel = rejected ? "Rejected" : approved ? "Accepted" : "Pending";
  const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const range = req.startDate === req.endDate ? fmt(req.startDate) : `${fmt(req.startDate)} → ${fmt(req.endDate)}`;
  return (
    <div className="flex items-start gap-2 rounded-lg border px-3 py-2"
      style={{
        borderColor: rejected ? "var(--risk)" : approved ? "var(--ok)" : "var(--border)",
        backgroundColor: rejected
          ? "color-mix(in srgb, var(--risk) 8%, transparent)"
          : approved
            ? "color-mix(in srgb, var(--ok) 8%, transparent)"
            : "var(--surface)",
      }}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span style={{ color: "var(--text)" }}>{range}</span>
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `color-mix(in srgb, ${statusColor} 15%, transparent)`, color: statusColor }}>
            {statusLabel}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            · {req.totalDays} day{req.totalDays === 1 ? "" : "s"}
          </span>
        </div>
        <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{req.reason}</div>
        {rejected && (
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--risk)" }}>
            Rejection reason: {req.rejectionReason || "—"}
          </div>
        )}
      </div>
      {deletable && (
        <button type="button" onClick={onDelete} disabled={disabled} title="Delete request" aria-label="Delete request"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--risk)" }}>
          <Trash2 size={12} />
        </button>
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
          {holiday.podId ? holiday.kind : "Accepted leave"}
        </div>
      </div>
      {holiday.podId ? (
        // Pod-wide holiday set by the Super-Admin — read-only here.
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
          title="Set by admin for your whole pod — contact your admin to change it."
        >
          Set by admin
        </span>
      ) : (
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
      )}
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
  // Bumped this whole row from text-[10px] / text-faint to text-[13px] /
  // text-(default). The point of the row is to make customer-zone times
  // immediately readable while planning availability — at 10px / muted it
  // was technically present but psychologically inert. Same compositional
  // shape (zone code + start–end times, separated by gap-x-3) so the layout
  // is unchanged; only the typography gets the volume knob turned up.
  return (
    <div
      className="ml-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium"
      style={{ color: "var(--text)" }}
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
          <span
            key={z.id}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-raised)",
            }}
          >
            <span
              className="text-[12px] font-bold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {z.id}
            </span>
            <span className="tabular-nums" style={{ color: "var(--text)" }}>
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
// Payouts tab — date-range × contract-category view
//
// Filter model:
//   • Top: date range presets (7d / 30d / 90d / YTD / All / Custom) +
//     two date inputs for the custom case
//   • Tabs: All / Build / Golive / Maintain
//
// What each category shows:
//   • Build      → paid sessions count, total minutes, billable minutes
//                  (minutes are the unit of value here — per-minute work)
//   • Golive     → count of distinct projects that the engineer worked on
//                  whose project.contract_type='golive'
//   • Maintain   → count of distinct projects currently being maintained
//                  (project.contract_type='maintain' + activity in range)
//
// No revenue display — per the user, value is implicit in the categories.
// The data sources are the new engineer_contract_summary view (rollup) and
// engineer_session_history view (per-row, joined to projects.contract_type).
// ──────────────────────────────────────────────────────────────────────────

function PayoutsTab({ userId }: { userId: string }) {
  const sbRef = useRef(createClient());
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("30d"));
  const [category, setCategory] = useState<"all" | ContractType>("all");
  const [contractRollups, setContractRollups] = useState<ContractRollup[]>([]);
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch on userId + range changes. The view + history table are filtered
  // by date here so the engineer sees totals for the selected window.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        // History query is the most flexible source — we can roll it up
        // client-side per contract_type AND get the recent-rows list in
        // one round-trip.
        let q = sb
          .from("engineer_session_history")
          .select("id, guest_name, duration_minutes, status, created_at, project_name, project_id, paid_extension_at, contract_type")
          .eq("engineer_user_id", userId)
          .order("created_at", { ascending: false });
        if (range.from) q = q.gte("created_at", `${range.from}T00:00:00.000Z`);
        if (range.to)   q = q.lte("created_at", `${range.to}T23:59:59.999Z`);
        const histRes = await q.limit(500);
        if (!alive) return;
        if (histRes.error) throw new Error(histRes.error.message);

        const rows = ((histRes.data ?? []) as Array<{
          id: string;
          guest_name: string | null;
          duration_minutes: number | null;
          status: string;
          created_at: string;
          project_name: string | null;
          project_id: string | null;
          paid_extension_at: string | null;
          contract_type: string | null;
        }>).map((r) => {
          const ct: ContractType | null = r.contract_type === "build" || r.contract_type === "golive" || r.contract_type === "maintain"
            ? r.contract_type
            : null;
          return {
            id: r.id,
            guestName: r.guest_name,
            durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
            status: r.status,
            createdAt: r.created_at,
            projectName: r.project_name,
            projectId: r.project_id,
            contractType: ct,
            paidExtensionAt: r.paid_extension_at,
          };
        });

        if (!alive) return;
        setRecent(rows);

        // Roll up per contract_type. Sessions with no project / no
        // contract_type fall into 'build' as a sensible default.
        const buckets = new Map<ContractType, ContractRollup>();
        for (const t of CONTRACT_TYPES) {
          buckets.set(t, {
            contractType: t,
            paidSessions: 0,
            totalSessions: 0,
            totalMinutes: 0,
            billableMinutes: 0,
            distinctProjects: 0,
          });
        }
        const projectSets = new Map<ContractType, Set<string>>();
        for (const t of CONTRACT_TYPES) projectSets.set(t, new Set());
        for (const r of rows) {
          const ct: ContractType = r.contractType ?? "build";
          const b = buckets.get(ct)!;
          b.totalSessions += 1;
          if (r.paidExtensionAt) b.paidSessions += 1;
          if (r.durationMinutes != null) {
            b.totalMinutes += r.durationMinutes;
            if (r.status === "ended") b.billableMinutes += r.durationMinutes;
          }
          if (r.projectId) projectSets.get(ct)!.add(r.projectId);
        }
        for (const t of CONTRACT_TYPES) {
          buckets.get(t)!.distinctProjects = projectSets.get(t)!.size;
        }
        setContractRollups(Array.from(buckets.values()));
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Couldn't load earnings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId, range]);

  const totalSummary = useMemo(() => {
    let totalMinutes = 0;
    let paidSessions = 0;
    let golives = 0;
    let maintains = 0;
    for (const r of contractRollups) {
      if (r.contractType === "build") {
        totalMinutes += r.totalMinutes;
        paidSessions += r.paidSessions;
      } else if (r.contractType === "golive") {
        golives += r.distinctProjects;
      } else if (r.contractType === "maintain") {
        maintains += r.distinctProjects;
      }
    }
    return { totalMinutes, paidSessions, golives, maintains };
  }, [contractRollups]);

  const visibleRows = useMemo(() => {
    if (category === "all") return recent.slice(0, 50);
    return recent.filter((r) => (r.contractType ?? "build") === category).slice(0, 50);
  }, [recent, category]);

  const rollupByCategory = useMemo(() => {
    const m = new Map<ContractType, ContractRollup>();
    for (const r of contractRollups) m.set(r.contractType, r);
    return m;
  }, [contractRollups]);

  return (
    <div className="flex flex-col gap-5">
      <SectionHead
        title="Payouts"
        blurb="Your work, grouped by contract phase. Build counts minutes; Go-live and Maintain count projects."
      />

      {/* Date range picker */}
      <DateRangePicker value={range} onChange={setRange} />

      {/* Category tabs */}
      <CategoryTabs active={category} onChange={setCategory} rollup={rollupByCategory} />

      {/* Top-line summary across all categories */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Build minutes" value={fmtMinutes(totalSummary.totalMinutes)} Icon={Clock} />
        <StatCard label="Paid sessions" value={String(totalSummary.paidSessions)} Icon={CreditCard} />
        <StatCard label="Go-lives" value={String(totalSummary.golives)} Icon={CheckCircle2} />
        <StatCard label="Maintaining" value={String(totalSummary.maintains)} Icon={Wrench} />
      </div>

      {/* Category-specific detail */}
      {!loading && !error && (
        <CategoryDetail category={category} rollup={rollupByCategory} />
      )}

      {/* Recent sessions list (filtered by category) */}
      <SectionHead
        title={category === "all" ? "Recent sessions" : `Recent ${category} sessions`}
        blurb={`Last ${Math.min(visibleRows.length, 50)} sessions in the selected window${category === "all" ? "" : ` for ${category}`}.`}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 className="size-4 animate-spin" /> Loading sessions…
        </div>
      ) : error ? (
        <SectionCard>
          <p className="text-sm" style={{ color: "var(--accent-red)" }}>{error}</p>
        </SectionCard>
      ) : visibleRows.length === 0 ? (
        <SectionCard>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            No sessions in this window. Try widening the date range or picking another category.
          </p>
        </SectionCard>
      ) : (
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}>
          {visibleRows.map((r, i) => {
            const ct: ContractType = r.contractType ?? "build";
            const ctColor = ct === "build" ? "var(--primary)" : ct === "golive" ? "#0ea5e9" : "#a855f7";
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i === visibleRows.length - 1 ? "none" : "1px solid var(--border)" }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${ctColor} 14%, transparent)`,
                    color: ctColor,
                  }}
                >
                  <CalendarIcon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                      {r.guestName ?? "Guest"}
                    </span>
                    {r.projectName && (
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        · {r.projectName}
                      </span>
                    )}
                    <span
                      className="rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${ctColor} 14%, transparent)`,
                        color: ctColor,
                      }}
                    >
                      {ct}
                    </span>
                    {r.paidExtensionAt && (
                      <span
                        className="rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--primary) 14%, transparent)",
                          color: "var(--primary)",
                        }}
                      >
                        Paid
                      </span>
                    )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Date range picker ────────────────────────────────────────────────────
function DateRangePicker({
  value, onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const presets: Array<{ id: Exclude<DateRangePresetId, "custom">; label: string }> = [
    { id: "7d", label: "Last 7 days" },
    { id: "30d", label: "Last 30 days" },
    { id: "90d", label: "Last 90 days" },
    { id: "ytd", label: "This year" },
    { id: "all", label: "All time" },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border p-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--text) 2%, var(--surface-raised))",
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const isActive = value.presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(rangeFromPreset(p.id))}
              aria-pressed={isActive}
              className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: isActive ? "var(--primary)" : "var(--border)",
                backgroundColor: isActive
                  ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                  : "var(--surface)",
                color: isActive ? "var(--primary)" : "var(--text-muted)",
              }}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange({ presetId: "custom", from: value.from, to: value.to })}
          aria-pressed={value.presetId === "custom"}
          className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
          style={{
            borderColor: value.presetId === "custom" ? "var(--primary)" : "var(--border)",
            backgroundColor: value.presetId === "custom"
              ? "color-mix(in srgb, var(--primary) 14%, transparent)"
              : "var(--surface)",
            color: value.presetId === "custom" ? "var(--primary)" : "var(--text-muted)",
          }}
        >
          Custom
        </button>
      </div>
      {value.presetId === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value || null })}
            className="rounded-md border px-2 py-1 text-[12px] outline-none"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
          />
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>→</span>
          <input
            type="date"
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value || null })}
            className="rounded-md border px-2 py-1 text-[12px] outline-none"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
          />
        </div>
      )}
    </div>
  );
}

// ── Category tabs ────────────────────────────────────────────────────────
function CategoryTabs({
  active, onChange, rollup,
}: {
  active: "all" | ContractType;
  onChange: (c: "all" | ContractType) => void;
  rollup: Map<ContractType, ContractRollup>;
}) {
  const tabs: Array<{ id: "all" | ContractType; label: string; meta: string }> = [
    {
      id: "all",
      label: "All",
      meta: "Everything in range",
    },
    {
      id: "build",
      label: "Build",
      meta: `${fmtMinutes(rollup.get("build")?.totalMinutes ?? 0)}`,
    },
    {
      id: "golive",
      label: "Go-live",
      meta: `${rollup.get("golive")?.distinctProjects ?? 0} project${(rollup.get("golive")?.distinctProjects ?? 0) === 1 ? "" : "s"}`,
    },
    {
      id: "maintain",
      label: "Maintain",
      meta: `${rollup.get("maintain")?.distinctProjects ?? 0} project${(rollup.get("maintain")?.distinctProjects ?? 0) === 1 ? "" : "s"}`,
    },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={isActive}
            className="flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-all"
            style={{
              borderColor: isActive ? "var(--primary)" : "var(--border)",
              backgroundColor: isActive
                ? "color-mix(in srgb, var(--primary) 8%, var(--surface-raised))"
                : "var(--surface-raised)",
              minWidth: 110,
            }}
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: isActive ? "var(--primary)" : "var(--text-muted)" }}
            >
              {t.label}
            </span>
            <span className="text-[12px] font-semibold" style={{ color: "var(--text)" }}>
              {t.meta}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Category detail card — explains the active category ─────────────────
function CategoryDetail({
  category, rollup,
}: {
  category: "all" | ContractType;
  rollup: Map<ContractType, ContractRollup>;
}) {
  if (category === "all") {
    return (
      <SectionCard>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--text)" }}>Build</strong> tracks per-minute work — the unit of value is your time on the call.
          {" "}
          <strong style={{ color: "var(--text)" }}>Go-live</strong> and <strong style={{ color: "var(--text)" }}>Maintain</strong> track counts of distinct projects — the unit is &ldquo;how many you took to live&rdquo; or &ldquo;how many you keep alive.&rdquo;
        </p>
      </SectionCard>
    );
  }
  const b = rollup.get(category);
  if (!b) return null;
  if (category === "build") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Paid sessions" value={String(b.paidSessions)} Icon={CreditCard} />
        <StatCard label="Total minutes" value={fmtMinutes(b.totalMinutes)} Icon={Clock} />
        <StatCard label="Billable minutes" value={fmtMinutes(b.billableMinutes)} Icon={TrendingUp} />
      </div>
    );
  }
  if (category === "golive") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Go-live projects" value={String(b.distinctProjects)} Icon={CheckCircle2} />
        <StatCard label="Sessions involved" value={String(b.totalSessions)} Icon={CalendarIcon} />
      </div>
    );
  }
  // maintain
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard label="Projects maintained" value={String(b.distinctProjects)} Icon={Wrench} />
      <StatCard label="Maintenance touches" value={String(b.totalSessions)} Icon={CalendarIcon} />
    </div>
  );
}

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
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

      <ActiveSessionsCard />
    </div>
  );
}

// ── Active sessions — real list with the 3-device sign-in cap ────────────
// Reads from list_my_devices (the user_devices table). Per-row "Sign out"
// hits revoke_my_device, which deletes the row + the underlying
// auth.sessions / auth.refresh_tokens entries so the kicked browser
// can't keep working. A banner explains the 3-device cap.
function ActiveSessionsCard() {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [myFingerprint, setMyFingerprint] = useState<string>("");

  useEffect(() => {
    setMyFingerprint(getOrCreateFingerprint());
    let alive = true;
    void (async () => {
      const list = await listMyDevices();
      if (!alive) return;
      setDevices(list);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const refresh = useCallback(async () => {
    const list = await listMyDevices();
    setDevices(list);
  }, []);

  const handleRevoke = useCallback(async (deviceId: string) => {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Sign out from this device? It'll be logged out immediately.")) {
      return;
    }
    setBusyId(deviceId);
    try {
      const ok = await revokeDevice(deviceId);
      if (ok) {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      } else {
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  }, [busyId, refresh]);

  const handleRevokeAllOthers = useCallback(async () => {
    if (busyId) return;
    const others = devices.filter((d) => d.device_fingerprint !== myFingerprint);
    if (others.length === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Sign out from ${others.length} other device${others.length === 1 ? "" : "s"}? They'll all be logged out immediately.`)) {
      return;
    }
    setBusyId("__bulk__");
    try {
      await Promise.all(others.map((d) => revokeDevice(d.id)));
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [busyId, devices, myFingerprint, refresh]);

  const isAtCap = devices.length >= 3;

  return (
    <SectionCard>
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
        >
          <Monitor className="size-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Active sessions</p>
            <span
              className="rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: isAtCap
                  ? "color-mix(in srgb, var(--warn) 14%, transparent)"
                  : "color-mix(in srgb, var(--primary) 14%, transparent)",
                color: isAtCap ? "var(--warn)" : "var(--primary)",
              }}
            >
              {devices.length} / 3
            </span>
          </div>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Up to 3 devices can be signed in at once. A 4th sign-in auto-kicks your oldest device.
          </p>

          {/* Device list */}
          <div className="mt-3 flex flex-col gap-1.5">
            {loading ? (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                <Loader2 className="size-3 animate-spin" /> Loading devices…
              </div>
            ) : devices.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>
                No registered devices. (You should see at least this one — refresh the page if it stays empty.)
              </p>
            ) : (
              devices.map((d) => {
                const isCurrent = d.device_fingerprint === myFingerprint;
                return (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    isCurrent={isCurrent}
                    busy={busyId === d.id}
                    onRevoke={() => void handleRevoke(d.id)}
                  />
                );
              })
            )}
          </div>

          {/* Bulk action — only shown when there's >1 device, since the
              current device is excluded from "all others" */}
          {devices.filter((d) => d.device_fingerprint !== myFingerprint).length > 0 && (
            <button
              type="button"
              disabled={busyId === "__bulk__"}
              onClick={() => void handleRevokeAllOthers()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              {busyId === "__bulk__" && <Loader2 size={10} className="animate-spin" />}
              Sign out everywhere else
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function DeviceRow({
  device, isCurrent, busy, onRevoke,
}: {
  device: UserDevice;
  isCurrent: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  const lastSeen = new Date(device.last_seen_at);
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
      style={{
        borderColor: isCurrent
          ? "color-mix(in srgb, var(--primary) 40%, transparent)"
          : "var(--border)",
        backgroundColor: isCurrent
          ? "color-mix(in srgb, var(--primary) 5%, transparent)"
          : "transparent",
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        <Monitor className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--text)" }}>
            {device.device_label ?? "Unknown device"}
          </span>
          {isCurrent && (
            <span
              className="rounded-full px-1 py-0 text-[8px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: "var(--primary)", color: "#fff" }}
            >
              This device
            </span>
          )}
        </div>
        <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          Last seen {lastSeen.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      </div>
      {!isCurrent && (
        <button
          type="button"
          disabled={busy}
          onClick={onRevoke}
          title="Sign out from this device"
          aria-label="Sign out from this device"
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
          style={{ color: "var(--accent-red)" }}
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
          Sign out
        </button>
      )}
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
