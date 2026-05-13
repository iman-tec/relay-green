import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings — Relay.green",
};

const SECTIONS = [
  { label: "Profile", desc: "Your name, email, and avatar." },
  { label: "Availability", desc: "Online hours, languages, and skills." },
  { label: "Notifications", desc: "Email + in-app alerts for new calls." },
  { label: "Payouts", desc: "Bank details and payout schedule." },
  { label: "Security", desc: "Sessions, devices, and 2FA." },
];

export default function SettingsPage() {
  return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
            Settings
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Manage your engineer profile and preferences.
          </p>
        </div>

        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          {SECTIONS.map((s, i) => (
            <button
              key={s.label}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              style={{
                borderTop: i === 0 ? "none" : `1px solid var(--border)`,
              }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {s.label}
                </div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {s.desc}
                </div>
              </div>
              <span style={{ color: "var(--text-muted)" }}>→</span>
            </button>
          ))}
        </div>
      </div>
  );
}
