import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthHeader } from "@/components/auth-header";

export default async function EngineerConsole() {
  const user = await requireRole("ENGINEER");

  const profile = await prisma.engineerProfile.findUnique({
    where: { userId: user.id },
    include: {
      skills: { orderBy: [{ skillType: "asc" }, { skillName: "asc" }] },
      compensation: true,
      supportSessions: {
        where: {
          status: { in: ["LIVE", "ENGINEER_ASSIGNED", "WAITING_FOR_ZOOM"] },
        },
        include: { customer: { select: { displayName: true } } },
        take: 5,
      },
    },
  });

  if (!profile) {
    return (
      <>
        <AuthHeader user={user} />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-2xl">Engineer profile not configured</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Internal admin must create your EngineerProfile before you can take
            sessions.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <AuthHeader user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl tracking-tight">{profile.aliasName}</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              {profile.bioSummary ?? "No bio set."}
            </p>
          </div>
          <div
            className="rounded-md border px-3 py-2 text-xs"
            style={{ borderColor: "var(--border)" }}
          >
            Status: <strong>{profile.status}</strong>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg">Active sessions</h2>
          {profile.supportSessions.length === 0 ? (
            <Empty hint="No active sessions. Set status to AVAILABLE to receive matches." />
          ) : (
            <ul className="flex flex-col gap-2">
              {profile.supportSessions.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border p-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="text-sm font-medium">
                    {s.customer.displayName} · {s.aiToolTrack ?? "—"}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {s.status} · {s.issueType ?? "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg">Verified skills</h2>
            <ul className="flex flex-wrap gap-2">
              {profile.skills.map((s) => (
                <li
                  key={s.id}
                  className="rounded-full border px-3 py-1 text-xs"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-muted)",
                  }}
                  title={`${s.skillType} · ${s.proficiency}${s.verified ? " · verified" : ""}`}
                >
                  {s.skillName}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-3 text-lg">Compensation</h2>
            {profile.compensation ? (
              <dl
                className="rounded-md border p-4 text-sm"
                style={{ borderColor: "var(--border)" }}
              >
                <Row
                  label="Employment"
                  value={profile.compensation.employmentType}
                />
                <Row
                  label="Bonus rate"
                  value={`${Number(profile.compensation.bonusPercentage ?? 0).toFixed(2)}% of attributed billing`}
                />
                <Row
                  label="Payroll currency"
                  value={profile.compensation.paymentCurrency}
                />
                <Row
                  label="Payroll vendor"
                  value={profile.compensation.payrollVendor}
                />
              </dl>
            ) : (
              <Empty hint="Compensation profile not configured." />
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-b-0">
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div
      className="rounded-md border border-dashed p-4 text-sm"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      {hint}
    </div>
  );
}
