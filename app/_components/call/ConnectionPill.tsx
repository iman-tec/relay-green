"use client";

import { Wifi, WifiOff } from "lucide-react";

type Props = { quality: "good" | "fair" | "poor" | "unknown" };

export function ConnectionPill({ quality }: Props) {
  const color =
    quality === "good"
      ? "var(--ok)"
      : quality === "fair"
        ? "var(--warn)"
        : quality === "poor"
          ? "var(--risk)"
          : "var(--text-muted)";
  const label =
    quality === "good"
      ? "Good"
      : quality === "fair"
        ? "Fair"
        : quality === "poor"
          ? "Poor"
          : "—";
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: "var(--border)", color }}
      aria-label={`Connection: ${label}`}
    >
      {quality === "unknown" || quality === "poor" ? (
        <WifiOff size={12} />
      ) : (
        <Wifi size={12} />
      )}
      <span>{label}</span>
    </div>
  );
}
