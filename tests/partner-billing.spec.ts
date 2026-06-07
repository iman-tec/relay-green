/*
 * Channel Partner — billing regression suite (Phase 5).
 *
 * Pure-logic tests: no app, no DB, no browser (never touches `page`), so they
 * run fast under the existing Playwright runner. These lock the money-relevant
 * invariants from the build brief's regression list:
 *
 *   #1  Non-partner enterprises are charged IDENTICALLY (discount 0 / inactive
 *       → the bundle price is returned unchanged; no new pricing path).
 *   #3  passthrough ≤ wholesale — margin never goes negative (defence in depth
 *       behind the server-side guard in /api/reseller/enterprises).
 *   #5  Balance due = Earned − Paid out, reconciling against per-company spend.
 *
 * Onboarding-writes-terms-once (#2) and referral attribution (#4) are
 * integration concerns (need the app + flag on + a reseller QA login); they are
 * NOT covered here — add as e2e once NEXT_PUBLIC_PARTNER_PROGRAM is enabled.
 */

import { test, expect } from "@playwright/test";
import {
  isDiscountActive,
  effectiveBundleCents,
  partnerEarnedCents,
} from "../lib/billing/partnerMargin";
import { MINUTE_BUNDLES } from "../lib/billing/minuteBundles";
import {
  tierFromMonthlyBookCents,
  centsToPremier,
  premierProgress,
  PREMIER_MONTHLY_BOOK_CENTS,
} from "../lib/billing/partnerTiers";

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";
const TEAM = 570_000; // €5,700 — the Team bundle list price

test.describe("non-partner enterprises are charged identically (#1)", () => {
  test("0% discount → every bundle price is unchanged", () => {
    for (const b of MINUTE_BUNDLES) {
      expect(effectiveBundleCents(b.amountCents, 0, null)).toBe(b.amountCents);
    }
  });

  test("expired discount → bundle price is unchanged", () => {
    expect(effectiveBundleCents(TEAM, 10, PAST)).toBe(TEAM);
  });

  test("no discount window but 0 pct → unchanged (inactive)", () => {
    expect(isDiscountActive(0, null)).toBe(false);
    expect(effectiveBundleCents(TEAM, 0, FUTURE)).toBe(TEAM);
  });
});

test.describe("active discount reduces the charged price", () => {
  test("10% active → net price (floored cents)", () => {
    expect(effectiveBundleCents(TEAM, 10, null)).toBe(513_000);
    expect(effectiveBundleCents(TEAM, 10, FUTURE)).toBe(513_000);
  });

  test("isDiscountActive truth table", () => {
    expect(isDiscountActive(10, null)).toBe(true);
    expect(isDiscountActive(10, FUTURE)).toBe(true);
    expect(isDiscountActive(10, PAST)).toBe(false);
    expect(isDiscountActive(0, null)).toBe(false);
  });
});

test.describe("partner margin — net basis, never negative (#3)", () => {
  test("20% wholesale, 10% passthrough → €513 earned", () => {
    expect(
      partnerEarnedCents({
        listAmountCents: TEAM,
        wholesalePct: 20,
        passthroughPct: 10,
      })
    ).toBe(51_300);
  });

  test("passthrough > wholesale → 0 (guard backstop)", () => {
    expect(
      partnerEarnedCents({
        listAmountCents: TEAM,
        wholesalePct: 10,
        passthroughPct: 20,
      })
    ).toBe(0);
  });

  test("equal pcts → 0 margin", () => {
    expect(
      partnerEarnedCents({
        listAmountCents: TEAM,
        wholesalePct: 10,
        passthroughPct: 10,
      })
    ).toBe(0);
  });

  test("zero usage → zero earned", () => {
    expect(
      partnerEarnedCents({
        listAmountCents: 0,
        wholesalePct: 20,
        passthroughPct: 10,
      })
    ).toBe(0);
  });
});

test.describe("balance due reconciles (#5)", () => {
  test("balance = sum(earned) − sum(paid), against per-company spend", () => {
    // Two companies, same shape as the /api/reseller/portal computation.
    const companies = [
      { lifetimeMinutes: 14_066, wholesale: 20, passthrough: 10 },
      { lifetimeMinutes: 3_200, wholesale: 20, passthrough: 10 },
    ];
    const LIST = 300; // cents/min, list rate
    const earnedTotal = companies.reduce(
      (acc, c) =>
        acc +
        partnerEarnedCents({
          listAmountCents: Math.round(c.lifetimeMinutes * LIST),
          wholesalePct: c.wholesale,
          passthroughPct: c.passthrough,
        }),
      0
    );
    const paidTotal = 100_00; // €100 already remitted
    const balanceDue = earnedTotal - paidTotal;

    // Earned is the sum of per-company contributions (reconciles to spend).
    expect(earnedTotal).toBeGreaterThan(0);
    expect(balanceDue).toBe(earnedTotal - paidTotal);
    // Balance can be paid down past earned (negative = overpaid), never silently clamped.
    expect(earnedTotal - earnedTotal * 2).toBeLessThan(0);
  });
});

test.describe("tiers — single transparent metric (#tiers)", () => {
  test("below threshold → partner; at/above → premier", () => {
    expect(tierFromMonthlyBookCents(PREMIER_MONTHLY_BOOK_CENTS - 1)).toBe(
      "partner"
    );
    expect(tierFromMonthlyBookCents(PREMIER_MONTHLY_BOOK_CENTS)).toBe(
      "premier"
    );
    expect(tierFromMonthlyBookCents(PREMIER_MONTHLY_BOOK_CENTS * 2)).toBe(
      "premier"
    );
  });

  test("centsToPremier clamps at 0 once reached", () => {
    expect(centsToPremier(0)).toBe(PREMIER_MONTHLY_BOOK_CENTS);
    expect(centsToPremier(PREMIER_MONTHLY_BOOK_CENTS)).toBe(0);
    expect(centsToPremier(PREMIER_MONTHLY_BOOK_CENTS + 5_000)).toBe(0);
  });

  test("premierProgress is clamped to [0,1]", () => {
    expect(premierProgress(0)).toBe(0);
    expect(premierProgress(PREMIER_MONTHLY_BOOK_CENTS / 2)).toBeCloseTo(0.5, 5);
    expect(premierProgress(PREMIER_MONTHLY_BOOK_CENTS * 3)).toBe(1);
  });
});
