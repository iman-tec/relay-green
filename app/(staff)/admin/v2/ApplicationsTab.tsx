"use client";

/*
 * Partner Applications tab — the super-admin review queue.
 *
 * Left: the application list (newest first, sortable by submitted-at or
 * status), each row showing company, contact, a status pill, and a duplicate
 * flag. Right: the selected application's full detail + the two terminal
 * actions — Approve (instant-provisions a live reseller via
 * /approve) and Reject (sends a decline via /reject). New applications are
 * visually obvious; empty / loading / error states are all handled.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Inbox,
  Check,
  Ban,
  Copy,
  ExternalLink,
  ArrowUpDown,
} from "lucide-react";

type Application = {
  id: string;
  contactName: string;
  workEmail: string;
  companyName: string;
  companyWebsite: string;
  countryRegion: string;
  clientsText: string;
  heardAbout: string | null;
  anythingElse: string | null;
  source: string;
  status: "new" | "approved" | "rejected";
  resellerId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  duplicate: boolean;
};

type SortKey = "date" | "status";

const STATUS_STYLE: Record<
  Application["status"],
  { label: string; bg: string; fg: string }
> = {
  new: {
    label: "New",
    bg: "var(--accent-soft, color-mix(in srgb, var(--accent) 15%, transparent))",
    fg: "var(--accent)",
  },
  approved: { label: "Approved", bg: "var(--ok-soft)", fg: "var(--ok)" },
  rejected: {
    label: "Rejected",
    bg: "var(--surface-raised)",
    fg: "var(--text-faint)",
  },
};

// new sorts before approved before rejected (the action-needed ones float up).
const STATUS_ORDER: Record<Application["status"], number> = {
  new: 0,
  approved: 1,
  rejected: 2,
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusPill({ status }: { status: Application["status"] }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

export function ApplicationsTab() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/partner-applications", {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        applications?: Application[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Couldn't load applications.");
      setApps(body.applications ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load applications.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // Initial load sets loading synchronously inside load(); intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...apps];
    if (sortKey === "status") {
      copy.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          b.createdAt.localeCompare(a.createdAt)
      );
    } else {
      copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return copy;
  }, [apps, sortKey]);

  const selected = useMemo(
    () => apps.find((a) => a.id === selId) ?? null,
    [apps, selId]
  );

  const newCount = useMemo(
    () => apps.filter((a) => a.status === "new").length,
    [apps]
  );

  async function act(kind: "approve" | "reject") {
    if (!selected || acting) return;
    if (
      kind === "reject" &&
      !window.confirm(
        `Reject ${selected.companyName}'s application and send a decline email?`
      )
    )
      return;
    setActing(true);
    setActionMsg(null);
    try {
      const res = await fetch(
        `/api/admin/partner-applications/${selected.id}/${kind}`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reseller?: { resellerCode: string };
        alreadyApproved?: boolean;
        declineEmailSent?: boolean;
      };
      if (!res.ok) throw new Error(body.error || `Couldn't ${kind}.`);
      if (kind === "approve") {
        setActionMsg(
          body.reseller?.resellerCode
            ? `Provisioned reseller ${body.reseller.resellerCode}. Invite sent.`
            : body.alreadyApproved
              ? "Already approved."
              : "Approved."
        );
      } else {
        setActionMsg(
          body.declineEmailSent
            ? "Application rejected — decline email sent."
            : "Application rejected. (Decline email not sent — email service not configured.)"
        );
      }
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : `Couldn't ${kind}.`);
    } finally {
      setActing(false);
    }
  }

  // ── States ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2
          className="h-5 w-5 animate-spin"
          style={{ color: "var(--text-faint)" }}
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p style={{ color: "var(--danger, #c0392b)" }}>{error}</p>
        <button
          onClick={() => void load()}
          className="rounded-md px-3 py-1.5 text-sm"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (apps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Inbox className="h-8 w-8" style={{ color: "var(--text-faint)" }} />
        <p style={{ color: "var(--text-muted)" }}>
          No partner applications yet.
        </p>
        <p style={{ color: "var(--text-faint)", fontSize: 13 }}>
          They&apos;ll appear here as they come in from /partner/apply.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* List */}
      <div
        className="flex min-h-0 w-[380px] flex-col border-r"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {apps.length} application{apps.length === 1 ? "" : "s"}
            {newCount > 0 && (
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                {" "}
                · {newCount} new
              </span>
            )}
          </div>
          <button
            onClick={() =>
              setSortKey((k) => (k === "date" ? "status" : "date"))
            }
            className="flex items-center gap-1 rounded px-2 py-1 text-xs"
            style={{ color: "var(--text-muted)" }}
            title="Toggle sort"
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortKey === "date" ? "Newest" : "Status"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sorted.map((a) => {
            const active = a.id === selId;
            return (
              <button
                key={a.id}
                onClick={() => {
                  setSelId(a.id);
                  setActionMsg(null);
                }}
                className="block w-full px-4 py-3 text-left"
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: active ? "var(--surface-raised)" : "transparent",
                  borderLeft: active
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    style={{
                      fontWeight: 600,
                      color: "var(--text)",
                      fontSize: 14,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.companyName}
                  </span>
                  <StatusPill status={a.status} />
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {a.contactName} · {fmtDate(a.createdAt)}
                </div>
                {a.duplicate && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--warn)",
                      marginTop: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Copy className="h-3 w-3" /> Possible duplicate
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center">
            <p style={{ color: "var(--text-faint)" }}>
              Select an application to review.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--text)",
                    margin: 0,
                  }}
                >
                  {selected.companyName}
                </h2>
                <a
                  href={
                    selected.companyWebsite.startsWith("http")
                      ? selected.companyWebsite
                      : `https://${selected.companyWebsite}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1"
                  style={{ color: "var(--accent)", fontSize: 13, marginTop: 4 }}
                >
                  {selected.companyWebsite}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <StatusPill status={selected.status} />
            </div>

            {selected.duplicate && (
              <div
                className="mt-4 rounded-md px-3 py-2"
                style={{
                  background: "var(--warn-soft, rgba(180,120,0,0.08))",
                  color: "var(--warn)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Copy className="h-4 w-4" /> An earlier application shares this
                email or company — review before approving.
              </div>
            )}

            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact" value={selected.contactName} />
              <Field
                label="Work email"
                value={selected.workEmail}
                mono
                copyable
              />
              <Field label="Country / region" value={selected.countryRegion} />
              <Field label="Submitted" value={fmtDate(selected.createdAt)} />
            </dl>

            <Block label="Who are their clients / what they sell">
              {selected.clientsText}
            </Block>
            {selected.heardAbout && (
              <Block label="How they heard about Relay">
                {selected.heardAbout}
              </Block>
            )}
            {selected.anythingElse && (
              <Block label="Anything else">{selected.anythingElse}</Block>
            )}

            {selected.status === "approved" && (
              <div
                className="mt-6 rounded-md px-3 py-2"
                style={{
                  background: "var(--ok-soft, rgba(0,150,80,0.08))",
                  color: "var(--ok)",
                  fontSize: 13,
                }}
              >
                Approved — a live reseller was provisioned and the partner
                invite sent.
              </div>
            )}

            {actionMsg && (
              <div
                className="mt-6 rounded-md px-3 py-2"
                style={{
                  background: "var(--surface-raised)",
                  color: "var(--text)",
                  fontSize: 13,
                }}
                role="status"
              >
                {actionMsg}
              </div>
            )}

            {selected.status === "new" && (
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => void act("approve")}
                  disabled={acting}
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-fg, #fff)",
                    opacity: acting ? 0.6 : 1,
                  }}
                >
                  {acting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Approve &amp; provision
                </button>
                <button
                  onClick={() => void act("reject")}
                  disabled={acting}
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    opacity: acting ? 0.6 : 1,
                  }}
                >
                  <Ban className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div>
      <dt
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-faint)",
          marginBottom: 4,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: 14,
          color: "var(--text)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {value}
        {copyable && (
          <button
            onClick={() => void navigator.clipboard?.writeText(value)}
            title="Copy"
            style={{ color: "var(--text-faint)" }}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </dd>
    </div>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-faint)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
        }}
      >
        {children}
      </p>
    </div>
  );
}
