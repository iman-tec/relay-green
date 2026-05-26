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
import {
  Bell, BellRing, Calendar as CalendarIcon, Check, ChevronRight,
  Clock, Download as DownloadIcon, Globe, KeyRound, Loader2, Mail,
  Monitor, Plus, ShieldCheck, Sparkles, Trash2,
  TrendingUp, User, Wallet, X,
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

  const [tab, setTab] = useState<EngineerTab>(initialTab);
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
        className="flex shrink-0 items-center gap-3 border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex flex-1 items-center gap-3">
          <Sparkles size={14} style={{ color: "var(--primary)" }} />
          <h1
            className="text-[15px] font-semibold tracking-tight"
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
// Calendar tab — weekly grid of availability windows
// ──────────────────────────────────────────────────────────────────────────
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
  const tz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }, []);

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

  const addWindow = useCallback(async (weekday: number) => {
    if (busy) return;
    // Default: 9 AM – 5 PM. The engineer can edit start/end after adding.
    const existing = windows.filter((w) => w.weekday === weekday);
    // Default window placement: try 9-17, fall back to non-overlapping slot.
    let startMin = 9 * 60;
    let endMin = 17 * 60;
    if (existing.some((w) => w.startMinute === startMin)) {
      const lastEnd = existing.reduce((m, w) => Math.max(m, w.endMinute), 0);
      startMin = Math.min(lastEnd + 60, 22 * 60);
      endMin = Math.min(startMin + 120, 23 * 60);
    }
    setBusy(true);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("set_engineer_window", {
        _weekday: weekday,
        _start_minute: startMin,
        _end_minute: endMin,
        _timezone: tz,
      });
      if (error) throw new Error(error.message);
      setWindows((prev) => [...prev, { weekday, startMinute: startMin, endMinute: endMin, timezone: tz }]
        .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute));
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't save window." });
    } finally {
      setBusy(false);
    }
  }, [busy, windows, tz, showBanner]);

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

  const updateWindow = useCallback(async (
    weekday: number, oldStartMin: number, newStartMin: number, newEndMin: number
  ) => {
    if (newStartMin >= newEndMin) {
      showBanner({ tone: "risk", text: "End time must be after start time." });
      return;
    }
    setBusy(true);
    try {
      const sb = sbRef.current;
      if (oldStartMin !== newStartMin) {
        // Composite PK includes start_minute. Drop then re-insert.
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
        const next = prev.filter((w) => !(w.weekday === weekday && w.startMinute === oldStartMin));
        next.push({ weekday, startMinute: newStartMin, endMinute: newEndMin, timezone: tz });
        return next.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
      });
    } catch (err) {
      showBanner({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't update window." });
    } finally {
      setBusy(false);
    }
  }, [tz, showBanner]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="size-4 animate-spin" /> Loading calendar…
      </div>
    );
  }

  const byDay: AvailabilityWindow[][] = Array.from({ length: 7 }, () => []);
  for (const w of windows) byDay[w.weekday].push(w);

  return (
    <div className="flex flex-col gap-6">
      <SectionHead
        title="Calendar"
        blurb="Recurring weekly availability. Offline customers can book a slot inside these windows."
      />

      <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
        <Globe size={12} />
        Timezone: <span style={{ color: "var(--text)" }}>{tz}</span>
      </div>

      <div className="flex flex-col gap-3">
        {WEEKDAYS.map((wdLabel, weekday) => (
          <SectionCard key={weekday}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
                {wdLabel}
              </span>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Plus className="size-3.5" />}
                disabled={busy}
                onClick={() => void addWindow(weekday)}
              >
                Add window
              </Button>
            </div>
            {byDay[weekday].length === 0 ? (
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
                Unavailable.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {byDay[weekday].map((w) => (
                  <WindowRow
                    key={w.startMinute}
                    weekday={weekday}
                    window={w}
                    disabled={busy}
                    onUpdate={(newStart, newEnd) => void updateWindow(weekday, w.startMinute, newStart, newEnd)}
                    onRemove={() => void removeWindow(weekday, w.startMinute)}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

function WindowRow({
  window: w, disabled, onUpdate, onRemove,
}: {
  weekday: number;
  window: AvailabilityWindow;
  disabled: boolean;
  onUpdate: (newStart: number, newEnd: number) => void;
  onRemove: () => void;
}) {
  const [startStr, setStartStr] = useState(minutesToHHMM(w.startMinute));
  const [endStr, setEndStr] = useState(minutesToHHMM(w.endMinute));

  const commit = () => {
    const ns = hhmmToMinutes(startStr);
    const ne = hhmmToMinutes(endStr);
    if (ns == null || ne == null) return;
    if (ns === w.startMinute && ne === w.endMinute) return;
    onUpdate(ns, ne);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={startStr}
        disabled={disabled}
        onChange={(e) => setStartStr(e.target.value)}
        onBlur={commit}
        className="rounded-md border px-2 py-1 text-[12px] outline-none"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--background)",
          color: "var(--text)",
        }}
      />
      <span style={{ color: "var(--text-muted)" }}>–</span>
      <input
        type="time"
        value={endStr}
        disabled={disabled}
        onChange={(e) => setEndStr(e.target.value)}
        onBlur={commit}
        className="rounded-md border px-2 py-1 text-[12px] outline-none"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--background)",
          color: "var(--text)",
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        title="Remove window"
        aria-label="Remove window"
        className="ml-auto inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        style={{ color: "var(--text-muted)" }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
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
