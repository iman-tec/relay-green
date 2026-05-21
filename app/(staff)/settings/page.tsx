import type { Metadata } from "next";
import { ChevronRight, User, Clock, Bell, CreditCard, ShieldCheck } from "lucide-react";
import { SectionHeader, Card } from "@/app/_components/ui";

export const metadata: Metadata = {
  title: "Settings — Relay.green",
};

const SECTIONS = [
  { label: "Profile", desc: "Your name, email, and avatar.", icon: User },
  { label: "Availability", desc: "Online hours, languages, and skills.", icon: Clock },
  { label: "Notifications", desc: "Email + in-app alerts for new calls.", icon: Bell },
  { label: "Payouts", desc: "Bank details and payout schedule.", icon: CreditCard },
  { label: "Security", desc: "Sessions, devices, and 2FA.", icon: ShieldCheck },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <SectionHeader
        title="Settings"
        subtitle="Manage your engineer profile and preferences."
      />

      <Card variant="surface">
        {SECTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              type="button"
              className={
                "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--green-dot)]" +
                (i === 0 ? "" : " border-t border-[var(--border)]")
              }
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[var(--text-muted)]">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--text)]">
                  {s.label}
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {s.desc}
                </div>
              </div>
              <ChevronRight size={16} className="text-[var(--text-muted)]" />
            </button>
          );
        })}
      </Card>
    </div>
  );
}
