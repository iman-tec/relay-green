"use client";

/*
 * ContextCard — "Context for your engineer" summary.
 *
 * Renders a tidy, glanceable card built from the in-progress
 * IntakeContext (lib/intake/intakeAssistant.ts). Shown in the right
 * pane of the matching screen and inside the live room while a call is
 * connecting. Hands the engineer instant context the moment they join.
 *
 * UI-only. The card reads `ctx` from local state passed by its parent.
 * When backend persists the assistant transcript, this component does
 * not change — it just renders whatever IntakeContext shape it gets.
 */

import { Sparkles, Layers, AlertTriangle, Bot, Paperclip } from "lucide-react";
import type { IntakeContext } from "@/lib/intake/intakeAssistant";
import { contextIsUseful } from "@/lib/intake/intakeAssistant";
import { Card, CardBody, EmptyState } from "@/app/_components/ui";

export function ContextCard({ ctx }: { ctx: IntakeContext }) {
  const useful = contextIsUseful(ctx);

  if (!useful) {
    return (
      <Card variant="hollow">
        <CardBody>
          <EmptyState
            compact
            icon={<Sparkles size={18} className="text-[var(--primary)]" />}
            title="Context for your engineer"
            body="Tell us a bit while we connect you — we'll line everything up for them."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card variant="raised">
      <CardBody className="space-y-4">
        <header className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
            <Sparkles size={14} />
          </span>
          <h3 className="font-serif text-base font-medium text-[var(--text)]">
            Context for your engineer
          </h3>
        </header>

        <dl className="grid gap-3">
          {ctx.building && (
            <ContextRow
              icon={<Layers size={14} />}
              label="Building"
              value={ctx.building}
            />
          )}
          {ctx.problem && (
            <ContextRow
              icon={<AlertTriangle size={14} />}
              label="What's blocked"
              value={ctx.problem}
              tone="warn"
            />
          )}
          {ctx.stack && (
            <ContextRow
              icon={<Bot size={14} />}
              label="Stack"
              value={ctx.stack}
            />
          )}
          {ctx.aiTools && (
            <ContextRow
              icon={<Bot size={14} />}
              label="AI tools"
              value={ctx.aiTools}
            />
          )}
        </dl>

        {ctx.attachments.length > 0 && (
          <div className="border-t border-[var(--border)] pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
              <Paperclip size={11} /> Attachments
            </p>
            <ul className="grid grid-cols-3 gap-2">
              {ctx.attachments.map((a, i) =>
                a ? (
                  <li
                    key={i}
                    className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
                    title={a.name}
                  >
                    {a.mime.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.previewUrl}
                        alt={a.name}
                        className="block aspect-square size-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center px-2 text-center text-[10px] text-[var(--text-muted)]">
                        {a.name}
                      </div>
                    )}
                  </li>
                ) : null
              )}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ContextRow({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full " +
          (tone === "warn"
            ? "bg-[var(--warn-soft)] text-[var(--warn)]"
            : "bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[var(--text-muted)]")
        }
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
          {label}
        </dt>
        <dd className="mt-0.5 text-sm leading-snug whitespace-pre-wrap text-[var(--text)]">
          {value}
        </dd>
      </div>
    </div>
  );
}
