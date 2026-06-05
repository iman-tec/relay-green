/*
 * Staff route-group fallback. Next.js mounts this as the Suspense
 * fallback while the next page's server components stream in — instant
 * "your click was acknowledged" feedback. The StaffShell (from the
 * group layout) stays mounted, so this only swaps the content pane.
 */

export default function StaffLoading() {
  return (
    <div className="mx-auto max-w-screen-xl space-y-4 px-6 py-8">
      {/* Title placeholder */}
      <div className="space-y-2">
        <span
          className="block h-6 w-44 animate-pulse rounded"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
          }}
        />
        <span
          className="block h-3 w-72 animate-pulse rounded"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
          }}
        />
      </div>

      {/* KPI strip placeholder */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border"
            style={{
              borderColor: "var(--border)",
              backgroundColor:
                "color-mix(in srgb, var(--text) 4%, var(--surface))",
              animationDelay: `${i * 40}ms`,
            }}
          />
        ))}
      </div>

      {/* Content card placeholder */}
      <div
        className="rounded-xl border"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div
          className="border-b px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="block h-4 w-32 animate-pulse rounded"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--text) 8%, transparent)",
            }}
          />
        </div>
        <ul>
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 border-t px-5 py-3"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="h-8 w-8 shrink-0 animate-pulse rounded-full"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--text) 8%, transparent)",
                  animationDelay: `${i * 60}ms`,
                }}
              />
              <div className="flex-1 space-y-1.5">
                <span
                  className="block h-3 w-1/3 animate-pulse rounded"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--text) 8%, transparent)",
                    animationDelay: `${i * 60}ms`,
                  }}
                />
                <span
                  className="block h-2.5 w-1/4 animate-pulse rounded"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--text) 5%, transparent)",
                    animationDelay: `${i * 60 + 30}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
