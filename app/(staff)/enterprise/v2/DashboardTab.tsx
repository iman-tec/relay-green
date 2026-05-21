"use client";

export function DashboardTab() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Dashboard tab — coming soon
        </h3>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          KPI strip + activity sparkline + recent sessions, reshaped from the
          legacy /enterprise landing page.
        </p>
      </div>
    </div>
  );
}
