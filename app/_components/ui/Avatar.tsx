"use client";

/*
 * Avatar — circular identity glyph. Falls back to initials from a name
 * or email. No remote image fetching unless `src` is provided.
 *
 *  Sizes: xs (24) | sm (32) | md (40) | lg (56).
 *  Pass `tone="ok"` to render a green halo (for "online" supervisor in
 *  the Operations pod table).
 */

import { cn } from "./cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: AvatarSize;
  tone?: "ok" | "neutral";
  className?: string;
}

const SIZE: Record<AvatarSize, string> = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
};

function initials(name?: string | null, email?: string | null): string {
  const src = (name ?? email ?? "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return src.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({
  src,
  name,
  email,
  size = "md",
  tone = "neutral",
  className,
}: AvatarProps) {
  const label = initials(name, email);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium uppercase tracking-wide",
        "bg-[var(--surface-raised)] text-[var(--text)] border",
        tone === "ok" ? "border-[var(--ok)]" : "border-[var(--border)]",
        SIZE[size],
        className,
      )}
      aria-label={name ?? email ?? "User"}
    >
      {src ? (
        // Avatar img is decorative — name announces identity via aria-label.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="size-full rounded-full object-cover"
        />
      ) : (
        label
      )}
    </span>
  );
}
