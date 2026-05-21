"use client";

/*
 * "You are signed in as …" chip used in the v2 panel top bars.
 *
 * Avatar (initials) + two-line email/role stacked text. Same idea as
 * the legacy StaffShell profile chip but inline, no dropdown — the
 * sign-out button is rendered separately next to it.
 */

export function UserChip({
  email,
  roleLabel,
}: {
  email:     string;
  roleLabel: string;
}) {
  const init = initials(email);
  return (
    <div className="hidden items-center gap-2.5 sm:flex">
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={{
          background: "color-mix(in srgb, var(--primary) 16%, transparent)",
          color:      "var(--primary)",
        }}
      >
        {init}
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className="max-w-[180px] truncate text-xs font-medium"
          style={{ color: "var(--text)" }}
          title={email}
        >
          {email}
        </span>
        <span className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
          {roleLabel}
        </span>
      </div>
    </div>
  );
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}
