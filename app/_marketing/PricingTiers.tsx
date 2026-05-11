"use client";

/*
 * Pricing tier grid with monthly/annual toggle. The annual price is
 * derived from the monthly amount (20% off, rounded) — kept simple
 * because the tier copy itself is identical between plans.
 */

import { useState } from "react";

type Tier = {
  name: string;
  tag: string;
  amount: string;
  per: string;
  cta: string;
  feats: string[];
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Free",
    tag: "Try Relay. No card needed.",
    amount: "€0",
    per: "",
    cta: "Get started",
    feats: [
      "One engineer session per month",
      "Chat modality",
      "Any of 9 AI tracks",
      "1 saved project",
    ],
  },
  {
    name: "Pro",
    tag: "For the builder shipping their own thing.",
    amount: "€39",
    per: "/ month",
    cta: "Start Pro",
    feats: [
      "Unlimited engineer sessions",
      "Chat, voice, and screen share",
      "Same engineer across sessions",
      "Pass the baton to a launch project",
      "AI co-pilot during sessions",
    ],
  },
  {
    name: "Max",
    tag: "For solo founders running revenue on AI builds.",
    amount: "€249",
    per: "/ month",
    featured: true,
    cta: "Start Max",
    feats: [
      "Everything in Pro",
      "Priority dispatch — 30s target",
      "Dedicated lead engineer",
      "Project workspace + Git mirroring",
      "Quarterly architecture review",
      "Eligible for Leg 3 retainer",
    ],
  },
  {
    name: "Teams",
    tag: "For business heads supporting 50+ AI builders.",
    amount: "Talk to us",
    per: "",
    cta: "Contact sales",
    feats: [
      "Departmental rollout",
      "SSO / SCIM / audit log",
      "Engineer pod, named",
      "SOC 2 Type II + GDPR + DPDP",
      "Quarterly business review",
      "Annual contract",
    ],
  },
];

function discount(monthly: string): string {
  if (!monthly.startsWith("€")) return monthly;
  const n = parseInt(monthly.replace(/\D/g, ""), 10);
  if (Number.isNaN(n) || n === 0) return monthly;
  return "€" + Math.round(n * 0.8);
}

export function PricingTiers() {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");

  return (
    <>
      <div
        className="r-modality"
        style={{
          display: "inline-flex",
          maxWidth: 320,
          margin: "0 auto",
        }}
      >
        <button
          type="button"
          className={billing === "monthly" ? "active" : ""}
          onClick={() => setBilling("monthly")}
        >
          Monthly
        </button>
        <button
          type="button"
          className={billing === "annual" ? "active" : ""}
          onClick={() => setBilling("annual")}
        >
          Annual · save 20%
        </button>
      </div>

      <section style={{ borderTop: "1px solid var(--rule)", marginTop: 40 }}>
        <div className="r-wrap">
          <div className="r-pricing-grid">
            {TIERS.map((p) => {
              const shown = billing === "annual" ? discount(p.amount) : p.amount;
              return (
                <div
                  key={p.name}
                  className={"r-price-card" + (p.featured ? " featured" : "")}
                >
                  <h3 className="r-price-name">{p.name}</h3>
                  <p className="r-price-tag">{p.tag}</p>
                  <div className="r-price-amount">
                    {shown}
                    {p.per && <span className="per"> {p.per}</span>}
                  </div>
                  <ul className="r-price-feat">
                    {p.feats.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <div className="r-price-cta">
                    <button
                      type="button"
                      className={
                        p.featured ? "r-btn r-btn-green" : "r-btn r-btn-ink"
                      }
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      {p.cta} <span className="arrow">→</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
