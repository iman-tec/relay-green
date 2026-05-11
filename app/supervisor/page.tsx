import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthHeader } from "@/components/auth-header";

export default async function SupervisorConsole() {
  const user = await requireRole("SUPERVISOR");

  // Engineers reporting to this supervisor + their currently-live sessions
  const pod = await prisma.engineerProfile.findMany({
    where: { supervisorId: user.id },
    include: {
      supportSessions: {
        where: {
          status: {
            in: [
              "LIVE",
              "ENGINEER_ASSIGNED",
              "WAITING_FOR_ZOOM",
              "PAUSED",
              "ESCALATED",
            ],
          },
        },
        include: { customer: { select: { displayName: true } } },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { aliasName: "asc" },
  });

  return (
    <>
      <AuthHeader user={user} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-10">
        <section>
          <h1 className="text-3xl tracking-tight">Pod</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Live monitoring for {pod.length}{" "}
            {pod.length === 1 ? "engineer" : "engineers"}. Cards turn{" "}
            <span style={{ color: "var(--accent-red)" }}>red</span> when AI
            risk-scoring flags a session.
          </p>
        </section>

        {pod.length === 0 ? (
          <Empty hint="No engineers assigned to your pod yet. Internal admin can assign engineers via supervisorId." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {pod.map((eng) => {
              const session = eng.supportSessions[0];
              const isLive = session && session.status === "LIVE";
              return (
                <article
                  key={eng.id}
                  className="flex flex-col gap-2 rounded-xl border p-4"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                  }}
                >
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{eng.aliasName}</h3>
                    <StatusDot status={eng.status} />
                  </header>
                  {session ? (
                    <>
                      <p
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {session.customer.displayName}
                      </p>
                      <p className="text-xs">
                        {session.aiToolTrack ?? "—"} ·{" "}
                        {session.issueType ?? "—"}
                      </p>
                      <p
                        className="text-xs"
                        style={{
                          color: isLive
                            ? "var(--green-dot)"
                            : "var(--text-muted)",
                        }}
                      >
                        {session.status}
                      </p>
                    </>
                  ) : (
                    <p
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      No active session
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "AVAILABLE" || status === "IN_ZOOM"
      ? "var(--green-dot)"
      : status === "ESCALATED"
        ? "var(--accent-red)"
        : "var(--text-muted)";
  return (
    <span
      className="h-2 w-2 rounded-full"
      style={{ backgroundColor: color }}
      aria-label={status}
    />
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
