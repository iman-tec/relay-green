"use client";

/*
 * Sales — the Channel Partner's acquisition view. What a partner actually
 * cares about: their referral code / QR to share, and who signed up through
 * it. No client member detail — just acquisitions + commission, visualized.
 *
 * Referral link embeds the partner's code (?ref=<code>); enterprises in the
 * portfolio are the conversions (provisioned under this reseller). Commission
 * is derived from portfolio usage × rate × commission%.
 */

import { useMemo, useState } from "react";
import { Copy, Check, Share2, QrCode, TrendingUp, UserCheck, Sparkles, Percent } from "lucide-react";
import { EmptyState } from "@/app/_components/ui";
import {
  useApiData, eur, num, TabBody, StatCard, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Dashboard = {
  reseller: { name: string; resellerCode: string; commission: number; totalEnterprises: number; activeEnterprises: number };
  enterprises: Array<{ id: string; name: string; status: string; usedMinutes: number; createdAt: string }>;
};

const CENTS_PER_MINUTE = 300;
const BRAND = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BRAND_DOMAIN) || "relay.green";

export function SalesTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>("/api/reseller/dashboard");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const code = data?.reseller.resellerCode ?? "";
  const refLink = `https://${BRAND}/?ref=${encodeURIComponent(code)}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(refLink)}`;
  const commissionPct = (data?.reseller.commission ?? 0) / 100;

  // Acquisitions by month + commission, from the portfolio.
  const months = useMemo(() => {
    const m = new Map<string, { acquired: number; commissionCents: number }>();
    const since = new Date(); since.setMonth(since.getMonth() - 6); since.setDate(1);
    // seed last 6 month keys so the axis is continuous
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i); d.setDate(1);
      m.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { acquired: 0, commissionCents: 0 });
    }
    for (const e of data?.enterprises ?? []) {
      const d = new Date(e.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (m.has(key)) {
        const b = m.get(key)!;
        b.acquired += 1;
        b.commissionCents += Math.round(e.usedMinutes * CENTS_PER_MINUTE * commissionPct);
      }
    }
    return Array.from(m.entries()).map(([period, v]) => ({ period, ...v }));
  }, [data, commissionPct]);

  const maxAcq = Math.max(1, ...months.map((m) => m.acquired));
  const totalCommission = (data?.enterprises ?? []).reduce(
    (s, e) => s + Math.round(e.usedMinutes * CENTS_PER_MINUTE * commissionPct), 0,
  );
  const newThisMonth = months[months.length - 1]?.acquired ?? 0;

  const copy = (what: "code" | "link") => {
    navigator.clipboard?.writeText(what === "code" ? code : refLink);
    setCopied(what); setTimeout(() => setCopied(null), 1500);
  };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: "Join Relay", text: `Get a human engineer in 90 seconds — via ${data?.reseller.name}`, url: refLink }); } catch { /* cancelled */ } }
    else copy("link");
  };

  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Sales</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon={<UserCheck size={16} />} value={num(data?.reseller.totalEnterprises)} label="Clients acquired" hint={`${num(data?.reseller.activeEnterprises)} active`} />
        <StatCard icon={<Sparkles size={16} />} value={num(newThisMonth)} label="New this month" />
        <StatCard icon={<Percent size={16} />} value={`${num(data?.reseller.commission)}%`} label="Commission rate" />
        <StatCard icon={<TrendingUp size={16} />} value={eur(totalCommission)} label="Commission (est.)" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Share / referral card */}
        <section className="rounded-2xl border p-5 lg:col-span-1" style={{ borderColor: "var(--primary)", background: "var(--primary-tint)" }}>
          <div className="mb-3 flex items-center gap-2">
            <QrCode size={16} style={{ color: "var(--primary-hover)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Your referral</h2>
          </div>
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-[var(--surface)] p-4" style={{ borderColor: "var(--border)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="Referral QR code" width={180} height={180} className="rounded-lg" />
            <div className="text-center">
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Partner code</div>
              <div className="font-mono text-lg font-semibold tracking-wider" style={{ color: "var(--text)" }}>{code || "—"}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <button type="button" onClick={() => copy("link")} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-raised)]" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              {copied === "link" ? <Check size={13} /> : <Copy size={13} />} {copied === "link" ? "Link copied" : "Copy referral link"}
            </button>
            <button type="button" onClick={() => copy("code")} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-raised)]" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              {copied === "code" ? <Check size={13} /> : <Copy size={13} />} {copied === "code" ? "Code copied" : "Copy code"}
            </button>
            <button type="button" onClick={() => void share()} className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white" style={{ background: "var(--primary)" }}>
              <Share2 size={13} /> Share
            </button>
          </div>
          <p className="mt-3 break-all text-center text-[11px]" style={{ color: "var(--text-faint)" }}>{refLink}</p>
        </section>

        {/* Acquisition chart */}
        <section className="rounded-2xl border lg:col-span-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Clients acquired by month</h2>
            <TrendingUp size={14} style={{ color: "var(--text-muted)" }} />
          </header>
          {(data?.enterprises ?? []).length === 0 ? (
            <div className="p-6"><EmptyState compact title="No clients yet" body="Share your code or QR to start acquiring clients." /></div>
          ) : (
            <>
              <div className="flex items-end justify-around gap-2 px-4 py-6" style={{ minHeight: 180 }}>
                {months.map((m) => {
                  const h = Math.round((m.acquired / maxAcq) * 130);
                  return (
                    <div key={m.period} className="flex flex-1 flex-col items-center gap-2">
                      <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text)" }}>{m.acquired || ""}</span>
                      <div className="flex w-full max-w-[40px] items-end" style={{ height: 130 }}>
                        <div className="w-full rounded-t transition-all" style={{ height: Math.max(m.acquired ? 6 : 2, h), background: m.acquired ? "var(--primary)" : "var(--surface-raised)" }} title={`${m.acquired} acquired · ${eur(m.commissionCents)} commission`} />
                      </div>
                      <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{m.period.slice(2)}</span>
                    </div>
                  );
                })}
              </div>
              <ul className="border-t" style={{ borderColor: "var(--border)" }}>
                {months.filter((m) => m.acquired > 0 || m.commissionCents > 0).reverse().map((m) => (
                  <li key={m.period} className="flex items-center justify-between border-t px-4 py-2.5 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                    <span className="text-sm" style={{ color: "var(--text)" }}>{m.period}</span>
                    <span className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {num(m.acquired)} client{m.acquired === 1 ? "" : "s"} · {eur(m.commissionCents)} commission
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </TabBody>
  );
}
