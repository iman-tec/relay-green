"use client";

/*
 * PodAllocationPanel — presentational placeholder.
 *
 * Anticipates the upcoming pod-allocation rule:
 *   - Each supervisor owns the first 10 engineers.
 *   - Engineers 11–15 spill into a second supervisor on join.
 *   - The 10-engineer threshold flips ownership/dynamic-allocation.
 *   - When the engineer's regular same-pod supervisor is online, prefer them;
 *     when offline, fall back to dynamic allocation.
 *
 * This component renders the *shape* of that data without enforcing it.
 * It's wired only to demo props so the design pattern lands ahead of the
 * real allocation logic.
 *
 *   // TODO(pod-allocation): wire to real pod / supervisor / engineer-slot
 *   // data once the allocation rule is finalised. This file is purely
 *   // presentational right now — no Supabase reads, no RPCs.
 */

import { Users, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader, cn } from "@/app/_components/ui";

export interface PodSlot {
  /** 1-based slot index inside the pod. */
  index: number;
  /** Engineer initials if filled, null for empty. */
  engineer?: { id: string; initials: string; online: boolean } | null;
}

export interface PodSupervisor {
  id: string;
  name: string;
  online: boolean;
  /** Slot range this supervisor primarily owns. Inclusive. */
  range: [number, number];
}

export interface PodAllocationPanelProps {
  podName: string;
  supervisors: PodSupervisor[];
  slots: PodSlot[];
  /** "10" is the spec threshold — slots 1..threshold belong to the primary
   * supervisor, threshold+1..end go to the spill supervisor. */
  primaryThreshold?: number;
  className?: string;
}

export function PodAllocationPanel({
  podName,
  supervisors,
  slots,
  primaryThreshold = 10,
  className,
}: PodAllocationPanelProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-[var(--primary-tint)] text-[var(--primary-hover)]">
            <Users size={14} />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--text)]">{podName}</div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Pod allocation · placeholder · TODO(pod-allocation)
            </div>
          </div>
        </div>
        <span className="text-[11px] text-[var(--text-muted)]">
          {slots.filter((s) => s.engineer).length}/{slots.length} slots
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {supervisors.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5"
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-2 rounded-full",
                  s.online ? "bg-[var(--ok)]" : "bg-[var(--text-faint)]",
                )}
              />
              <span className="text-xs font-medium text-[var(--text)]">{s.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                slots {s.range[0]}–{s.range[1]}
              </span>
              {s.online && (
                <span
                  aria-label="Online"
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--ok)]"
                >
                  <ShieldCheck size={10} /> online
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
          {slots.map((s) => {
            const isSpill = s.index > primaryThreshold;
            const filled = !!s.engineer;
            return (
              <div
                key={s.index}
                className={cn(
                  "relative flex aspect-square items-center justify-center rounded-lg border text-xs font-medium uppercase tracking-wide transition-colors",
                  filled
                    ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary-hover)]"
                    : "border-dashed border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-faint)]",
                  isSpill && !filled && "border-[var(--warn)] text-[var(--warn)]",
                )}
                title={
                  filled
                    ? `Slot ${s.index} — ${s.engineer?.initials}${s.engineer?.online ? " · online" : ""}`
                    : `Slot ${s.index} — empty${isSpill ? " (spill range)" : ""}`
                }
              >
                {filled ? s.engineer?.initials : s.index}
                {filled && s.engineer?.online && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 inline-flex size-2 rounded-full bg-[var(--ok)] ring-2 ring-[var(--surface)]"
                  />
                )}
                {isSpill && (
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 -right-0.5 text-[8px] font-semibold uppercase text-[var(--warn)]"
                  >
                    spill
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Slots 1–{primaryThreshold} belong to the pod's primary supervisor.
          Slots {primaryThreshold + 1}–{slots.length} are the spill range and
          allocate dynamically when the primary supervisor is offline.
        </p>
      </CardBody>
    </Card>
  );
}
