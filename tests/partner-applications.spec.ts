/*
 * Partner-application queue — pure-logic regression (Phase 6).
 *
 * Covers the duplicate-flagging invariant from the brief: a repeat application
 * (same email OR same company as an EARLIER one) is FLAGGED, never silently
 * merged or dropped. No app / DB / browser — runs fast under the Playwright
 * runner. The claim-RPC single-fire idempotency and the approve→provision path
 * are exercised against the live DB during verification, not here.
 */

import { test, expect } from "@playwright/test";
import { flagDuplicateApplications } from "../lib/partner/flagDuplicateApplications";

const T = (n: number) => `2026-06-08T${String(n).padStart(2, "0")}:00:00Z`;

test.describe("partner-application duplicate flagging", () => {
  test("no duplicates → empty set", () => {
    const dup = flagDuplicateApplications([
      { id: "a", workEmail: "a@x.com", companyName: "Acme", createdAt: T(1) },
      { id: "b", workEmail: "b@y.com", companyName: "Beta", createdAt: T(2) },
    ]);
    expect(dup.size).toBe(0);
  });

  test("same email as an earlier row → the LATER row is flagged", () => {
    const dup = flagDuplicateApplications([
      {
        id: "old",
        workEmail: "dup@x.com",
        companyName: "Acme",
        createdAt: T(1),
      },
      {
        id: "new",
        workEmail: "dup@x.com",
        companyName: "Other",
        createdAt: T(2),
      },
    ]);
    expect(dup.has("new")).toBe(true);
    expect(dup.has("old")).toBe(false);
  });

  test("same company (case/space-insensitive) → flagged", () => {
    const dup = flagDuplicateApplications([
      {
        id: "old",
        workEmail: "a@x.com",
        companyName: "Acme Inc",
        createdAt: T(1),
      },
      {
        id: "new",
        workEmail: "b@y.com",
        companyName: "  acme inc ",
        createdAt: T(2),
      },
    ]);
    expect(dup.has("new")).toBe(true);
  });

  test("email match is case-insensitive", () => {
    const dup = flagDuplicateApplications([
      {
        id: "old",
        workEmail: "Dup@X.com",
        companyName: "Acme",
        createdAt: T(1),
      },
      {
        id: "new",
        workEmail: "dup@x.com",
        companyName: "Other",
        createdAt: T(2),
      },
    ]);
    expect(dup.has("new")).toBe(true);
  });

  test("input order doesn't matter — oldest is never the flagged one", () => {
    // Same data, passed newest-first (as the API query returns it).
    const dup = flagDuplicateApplications([
      {
        id: "new",
        workEmail: "dup@x.com",
        companyName: "Other",
        createdAt: T(2),
      },
      {
        id: "old",
        workEmail: "dup@x.com",
        companyName: "Acme",
        createdAt: T(1),
      },
    ]);
    expect(dup.has("new")).toBe(true);
    expect(dup.has("old")).toBe(false);
  });

  test("three on the same email → the two later ones are flagged", () => {
    const dup = flagDuplicateApplications([
      { id: "1", workEmail: "d@x.com", companyName: "A", createdAt: T(1) },
      { id: "2", workEmail: "d@x.com", companyName: "B", createdAt: T(2) },
      { id: "3", workEmail: "d@x.com", companyName: "C", createdAt: T(3) },
    ]);
    expect(dup.has("1")).toBe(false);
    expect(dup.has("2")).toBe(true);
    expect(dup.has("3")).toBe(true);
  });
});
