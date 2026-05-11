import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthHeader } from "@/components/auth-header";

export default async function CustomerDashboard() {
  const user = await requireRole("CUSTOMER");

  const [projects, buckets, recentSessions] = await Promise.all([
    prisma.project.findMany({
      where: { customerId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.hourBucket.findMany({
      where: { customerId: user.id, status: "ACTIVE" },
      orderBy: { purchasedAt: "desc" },
    }),
    prisma.supportSession.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { engineer: { select: { aliasName: true } } },
    }),
  ]);

  return (
    <>
      <AuthHeader user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl tracking-tight">
              Welcome back, {user.displayName.split(" ")[0]}
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              Click the green dot when you&apos;re stuck. We&apos;ll match you
              to an engineer in seconds.
            </p>
          </div>
          <button
            className="flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--primary)" }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "var(--green-dot)" }}
            />
            Get help now
          </button>
        </section>

        <section>
          <h2 className="mb-3 text-lg">Active hour-buckets</h2>
          {buckets.length === 0 ? (
            <Empty hint="Buy a Stuck bucket (5 hrs / €195) to start getting help." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {buckets.map((b) => (
                <div
                  key={b.id}
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <div
                    className="text-sm"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {b.engagementType}
                  </div>
                  <div className="mt-1 text-2xl">
                    {Number(b.hoursRemaining).toFixed(1)} hrs
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    of {b.bucketSize} hrs · {b.currency}{" "}
                    {Number(b.effectiveRatePerHour).toFixed(0)}/hr
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg">Projects</h2>
            {projects.length === 0 ? (
              <Empty hint="Create a project to organise sessions and memory." />
            ) : (
              <ul className="flex flex-col gap-2">
                {projects.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-md border p-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="text-sm font-medium">{p.name}</div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {p.aiToolTrack ?? "—"} · {p.productType ?? "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="mb-3 text-lg">Recent sessions</h2>
            {recentSessions.length === 0 ? (
              <Empty hint="Your past sessions will appear here." />
            ) : (
              <ul className="flex flex-col gap-2">
                {recentSessions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-md border p-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="text-sm font-medium">
                      {s.engineer?.aliasName ?? "Awaiting match"} ·{" "}
                      {s.aiToolTrack ?? "—"}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {s.status} · {Number(s.billableMinutes).toFixed(0)} min ·{" "}
                      {s.currency} {Number(s.totalAmount).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </>
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
