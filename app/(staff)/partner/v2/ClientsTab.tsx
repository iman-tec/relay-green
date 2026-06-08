"use client";

/*
 * Clients — the companies this Channel Partner has onboarded. The partner
 * sees WHO they onboarded and HOW MUCH each company is spending (money), plus
 * their own commission. They do NOT see allocation (minute pools), departments
 * or members — a company manages its own people internally.
 *
 * Two segmented sub-views: Clients (portfolio: stat strip + master/detail) and
 * Invitations (the redesigned reseller-scoped InvitationsView). Status colours
 * are shared across both grids — green = active/accepted, amber = onboarding/
 * sent, red = suspended/revoked.
 *
 * Onboarding: the partner provisions a company by naming the individual who
 * becomes its enterprise admin (invited by email). That person then builds out
 * departments + members.
 */

import { useState } from "react";
import { Building2, UserPlus, Copy, Check, Share2, Search } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  StatusBadge,
  EmptyState,
  Avatar,
} from "@/app/_components/ui";
import { InvitationsView } from "./InvitationsView";
import {
  useApiData,
  eur,
  TabBody,
  LoadingState,
  ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

const BRAND =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BRAND_DOMAIN) ||
  "relay.green";

type Enterprise = {
  id: string;
  name: string;
  enterpriseCode: string;
  status: string;
  usedMinutes: number;
  createdAt: string;
  discountPct: number;
  discountUntil: string | null;
};
type Dashboard = {
  reseller: { commission: number };
  enterprises: Enterprise[];
};

const CENTS_PER_MINUTE = 300;
// Shared status palette for the Clients grid: green = active, amber =
// onboarding (pending), red = suspended, muted = churned.
const TONE: Record<string, "ok" | "warn" | "risk" | "neutral"> = {
  active: "ok",
  onboarding: "warn",
  churned: "neutral",
  suspended: "risk",
};

// Two sub-views. The Clients/Invitations switch lives in the page top bar
// (browser-style tabs in PanelClient); this component renders whichever the
// parent selects via the `view` prop.
export type ClientsView = "clients" | "invitations";

// Status filter chips for the enterprise list (mirrors the Invitations chips).
type StatusFilter = "all" | "active" | "suspended";
const STATUS_FILTERS: readonly { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
];

export function ClientsTab({ view }: { view: ClientsView }) {
  const dash = useApiData<Dashboard>("/api/reseller/dashboard");
  const [selId, setSelId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const ents = dash.data?.enterprises ?? [];
  const commissionPct = (dash.data?.reseller.commission ?? 0) / 100;
  const sel = ents.find((e) => e.id === selId) ?? null;
  const spend = (e: Enterprise) => e.usedMinutes * CENTS_PER_MINUTE;

  // Enterprise list filter — status chips + free-text search (name or code),
  // mirroring the Invitations controls.
  const q = query.trim().toLowerCase();
  const shownEnts = ents.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.enterpriseCode.toLowerCase().includes(q)
    );
  });

  // Onboarding
  const [open, setOpen] = useState(false);
  const [inviteKey, setInviteKey] = useState(0);
  const [co, setCo] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  // Configurable promo discount granted to the onboarded company.
  const [discountPct, setDiscountPct] = useState(10);
  const [discountMonths, setDiscountMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // After provisioning, we hold the shareable onboarding link the partner
  // hands to the enterprise individual (click → sign up → enterprise admin).
  const [created, setCreated] = useState<{
    company: string;
    email: string;
    url: string;
    discountPct: number;
    discountMonths: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const resetModal = () => {
    setOpen(false);
    setCreated(null);
    setCo("");
    setAdminName("");
    setAdminEmail("");
    setErr(null);
    setCopied(false);
  };

  const onboard = async () => {
    if (!co.trim() || !adminName.trim() || !adminEmail.trim()) {
      setErr("Enterprise name, admin name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/reseller/enterprises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // discountPct/discountMonths captured for the company's promo. // TODO(api):
        // persist on the org (no column yet) — UI-configurable in the meantime.
        body: JSON.stringify({
          name: co.trim(),
          adminDisplayName: adminName.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
          allocatedMinutes: 0,
          discountPct,
          discountMonths,
        }),
      });
      const b = (await r.json().catch(() => ({}))) as {
        error?: string;
        enterprise?: { enterpriseCode?: string };
      };
      if (!r.ok) throw new Error(b.error || "Could not onboard enterprise");
      const code = b.enterprise?.enterpriseCode ?? "";
      const email = adminEmail.trim().toLowerCase();
      // Verified onboarding link, also sent to the company email by the invite.
      // Signing up via it binds the individual as this company's enterprise
      // admin (carried by the org code) and confirms the email.
      const url = `https://${BRAND}/staff?onboard=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
      setCreated({
        company: co.trim(),
        email,
        url,
        discountPct,
        discountMonths,
      });
      dash.reload();
      setInviteKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not onboard enterprise");
    } finally {
      setBusy(false);
    }
  };

  const shareLink = async () => {
    if (!created) return;
    const nav = navigator as Navigator & {
      share?: (d: {
        title: string;
        text: string;
        url: string;
      }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({
          title: `Set up ${created.company} on Relay`,
          text: "Click to set up your enterprise's Relay account.",
          url: created.url,
        });
      } catch {
        /* cancelled */
      }
    } else {
      navigator.clipboard?.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Deactivate / reactivate a company. Suspend freezes the org + bans its
  // members' logins (server-side); reactivate flips it back.
  const setCompanyStatus = async (id: string, next: "suspended" | "active") => {
    const verb = next === "suspended" ? "Deactivate" : "Reactivate";
    const warn =
      next === "suspended"
        ? " Their members will lose access until you reactivate."
        : "";
    if (!window.confirm(`${verb} this enterprise?${warn}`)) return;
    const res = await fetch(`/api/reseller/enterprises/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) dash.reload();
    else
      window.alert(
        ((await res.json().catch(() => ({}))) as { error?: string }).error ??
          "Update failed."
      );
  };

  if (dash.loading)
    return (
      <TabBody>
        <LoadingState />
      </TabBody>
    );
  if (dash.error)
    return (
      <TabBody>
        <ErrorState message={dash.error} onRetry={dash.reload} />
      </TabBody>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "clients" ? (
          <TabBody>
            {/* Controls: search (left) + status chips and the onboard CTA on
                one line (right). */}
            {ents.length > 0 && (
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <Search
                    className="pointer-events-none absolute top-2.5 left-2.5 size-4"
                    style={{ color: "var(--text-muted)" }}
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search enterprises…"
                    className="w-full rounded-lg border bg-transparent py-2 pr-2 pl-8 text-sm outline-none"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--text)",
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_FILTERS.map((f) => {
                      const active = statusFilter === f.key;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setStatusFilter(f.key)}
                          className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                          style={{
                            borderColor: active
                              ? "var(--primary)"
                              : "var(--border)",
                            background: active
                              ? "var(--primary-tint)"
                              : "transparent",
                            color: active
                              ? "var(--primary-hover)"
                              : "var(--text-muted)",
                          }}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    size="sm"
                    iconLeft={<UserPlus size={14} />}
                    onClick={() => setOpen(true)}
                  >
                    Onboard an enterprise
                  </Button>
                </div>
              </div>
            )}

            {ents.length === 0 ? (
              <EmptyState
                icon={<Building2 size={20} />}
                title="No enterprises yet"
                body="Onboard your first enterprise — name the person who'll run their Relay account."
                action={
                  <Button onClick={() => setOpen(true)}>
                    Onboard an enterprise
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* List */}
                <div
                  className="overflow-hidden rounded-2xl border lg:col-span-1"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  {shownEnts.length === 0 ? (
                    <p
                      className="px-4 py-6 text-center text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      No enterprises match your search.
                    </p>
                  ) : (
                    <ul>
                      {shownEnts.map((e) => (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setSelId(e.id)}
                            className="flex w-full items-center gap-3 border-t px-3 py-3 text-left transition-colors first:border-t-0 hover:bg-[var(--surface-raised)]"
                            style={{
                              borderColor: "var(--border)",
                              background:
                                selId === e.id
                                  ? "var(--primary-tint)"
                                  : undefined,
                            }}
                          >
                            <Avatar size="sm" name={e.name} tone="brand" />
                            <div className="min-w-0 flex-1">
                              <div
                                className="truncate text-sm"
                                style={{ color: "var(--text)" }}
                              >
                                {e.name}
                              </div>
                              <div
                                className="text-xs tabular-nums"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {eur(spend(e))} spent
                              </div>
                            </div>
                            <StatusBadge
                              compact
                              tone={TONE[e.status] ?? "neutral"}
                            >
                              {e.status}
                            </StatusBadge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Detail — spend + commission, no allocation/departments/members */}
                <div className="lg:col-span-2">
                  {!sel ? (
                    <div
                      className="rounded-2xl border p-8"
                      style={{
                        borderColor: "var(--border)",
                        background: "var(--surface)",
                      }}
                    >
                      <EmptyState
                        compact
                        title="Select an enterprise"
                        body="See spend, commission and account status."
                      />
                    </div>
                  ) : (
                    <div
                      className="overflow-hidden rounded-2xl border"
                      style={{
                        borderColor: "var(--border)",
                        background: "var(--surface)",
                      }}
                    >
                      {/* Header strip — company name + ID. Theme-aware
                          (surface-raised) so it matches the rest of the app. */}
                      <div
                        className="flex items-center gap-3 border-b p-5"
                        style={{
                          borderColor: "var(--border)",
                          background: "var(--surface-raised)",
                        }}
                      >
                        <Avatar size="md" name={sel.name} tone="brand" />
                        <div className="min-w-0 flex-1">
                          <h2
                            className="truncate text-lg font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {sel.name}
                          </h2>
                          <p
                            className="font-mono text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {sel.enterpriseCode}
                          </p>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="p-5">
                        <div className="flex items-center justify-between gap-3">
                          <StatusBadge tone={TONE[sel.status] ?? "neutral"}>
                            {sel.status}
                          </StatusBadge>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setCompanyStatus(
                                sel.id,
                                sel.status === "active" ? "suspended" : "active"
                              )
                            }
                          >
                            {sel.status === "active"
                              ? "Deactivate"
                              : "Reactivate"}
                          </Button>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                          <Metric
                            label="Spend to date"
                            value={eur(spend(sel))}
                          />
                          <Metric
                            label="Your commission"
                            value={eur(Math.round(spend(sel) * commissionPct))}
                          />
                          <Metric
                            label="Discount"
                            value={
                              sel.discountPct > 0
                                ? `${sel.discountPct}%`
                                : "None"
                            }
                          />
                          <Metric
                            label="Client since"
                            value={new Date(sel.createdAt).toLocaleDateString()}
                          />
                        </dl>
                        {sel.discountPct > 0 && sel.discountUntil && (
                          <p
                            className="mt-2 text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {sel.discountPct}% discount applied{" "}
                            <strong style={{ color: "var(--text)" }}>
                              until{" "}
                              {new Date(sel.discountUntil).toLocaleDateString()}
                            </strong>
                            .
                          </p>
                        )}
                        <p
                          className="mt-5 text-xs leading-relaxed"
                          style={{ color: "var(--text-faint)" }}
                        >
                          This enterprise manages its own departments and
                          people. You see spend and commission — not their
                          internal teams or member details.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabBody>
        ) : (
          <TabBody>
            <InvitationsView reloadKey={inviteKey} />
          </TabBody>
        )}
      </div>

      <Modal
        open={open}
        onClose={resetModal}
        title={created ? "Share the onboarding link" : "Onboard an enterprise"}
        description={
          created
            ? `${created.company} is set up. Share this link or QR with ${created.email} — when they sign up they become the enterprise's admin.`
            : "Name the person who'll run this enterprise's Relay account. They become the enterprise admin and set up their own departments and team."
        }
        footer={
          created ? (
            <div className="flex justify-end">
              <Button onClick={resetModal}>Done</Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={resetModal} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={onboard}
                loading={busy}
                iconLeft={<UserPlus size={14} />}
              >
                Create & generate link
              </Button>
            </div>
          )
        }
      >
        {created ? (
          <div className="flex flex-col items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=0&data=${encodeURIComponent(created.url)}`}
              alt="Onboarding QR code"
              width={190}
              height={190}
              className="rounded-lg border"
              style={{ borderColor: "var(--border)" }}
            />
            <div
              className="w-full rounded-lg border p-2.5"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface-raised)",
              }}
            >
              <p
                className="text-center text-[11px] break-all"
                style={{ color: "var(--text-muted)" }}
              >
                {created.url}
              </p>
            </div>
            <div className="flex w-full gap-2">
              <Button
                full
                variant="secondary"
                iconLeft={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={() => {
                  navigator.clipboard?.writeText(created.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button
                full
                iconLeft={<Share2 size={14} />}
                onClick={() => void shareLink()}
              >
                Share
              </Button>
            </div>
            <div
              className="w-full rounded-lg border p-2.5 text-center text-xs"
              style={{
                borderColor: "var(--primary)",
                background: "var(--primary-tint)",
                color: "var(--text)",
              }}
            >
              {created.discountPct}% discount for {created.discountMonths}{" "}
              months applied to {created.company}.
            </div>
            <p
              className="text-center text-[11px]"
              style={{ color: "var(--text-faint)" }}
            >
              A verified invite link was also emailed to {created.email}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              label="Enterprise name"
              value={co}
              onChange={(e) => setCo(e.target.value)}
              placeholder="Acme Inc."
            />
            <Input
              label="Admin full name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Jordan Reed"
            />
            <Input
              label="Admin email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="jordan@acme.com"
            />
            <div className="grid grid-cols-2 gap-3">
              <label
                className="flex flex-col gap-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Enterprise discount
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                    className="h-10 w-full rounded-lg border px-3 text-sm"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--background)",
                      color: "var(--text)",
                    }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: "var(--text-muted)" }}
                  >
                    %
                  </span>
                </div>
              </label>
              <label
                className="flex flex-col gap-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                For
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={36}
                    value={discountMonths}
                    onChange={(e) => setDiscountMonths(Number(e.target.value))}
                    className="h-10 w-full rounded-lg border px-3 text-sm"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--background)",
                      color: "var(--text)",
                    }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: "var(--text-muted)" }}
                  >
                    months
                  </span>
                </div>
              </label>
            </div>
            {err && (
              <p className="text-xs" style={{ color: "var(--risk)" }}>
                {err}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd
        className="font-serif text-lg tabular-nums"
        style={{ color: "var(--text)" }}
      >
        {value}
      </dd>
    </div>
  );
}
