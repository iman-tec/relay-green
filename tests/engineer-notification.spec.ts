/*
 * Engineer push-notification flow: when a customer is queued, every engineer
 * sitting on any /inbox|/dashboard|/triage|/supervise|/settings page sees a
 * centered Accept / Decline card (the engineer-side mirror of the customer's
 * incoming-call card).
 */

import { test, expect, chromium } from "@playwright/test";
import {
  createTestUser, authPage, cleanupTestUsers, admin, deleteUserSessions,
} from "./helpers/supabase";

test.afterAll(async () => { await cleanupTestUsers(); });
test.setTimeout(90_000);

test.describe("engineer push notification", () => {
  test("queued customer pops a Accept/Decline card on engineer /inbox", async () => {
    const browser = await chromium.launch();
    const cust = await createTestUser("customer");
    const eng  = await createTestUser("engineer");
    const custCtx = await browser.newContext();
    const engCtx  = await browser.newContext();
    const custPage = await custCtx.newPage();
    const engPage  = await engCtx.newPage();

    try {
      // Clear stale queued so notification is deterministic.
      await admin.from("guest_calls").delete().eq("status", "queued");
      await authPage(custPage, cust);
      await authPage(engPage, eng);
      await deleteUserSessions(cust.id);

      // Engineer sits on /inbox first so the card pops via realtime, not the
      // initial-load query.
      await engPage.goto("/inbox");
      await expect(engPage.getByRole("heading", { name: /Welcome back/i })).toBeVisible({ timeout: 10_000 });

      // Customer lands → queued
      await custPage.goto("/room");
      await expect(custPage.getByRole("heading", { name: /Connecting/i })).toBeVisible({ timeout: 20_000 });

      // Engineer sees the incoming-request card
      await expect(engPage.getByText(/^Incoming request$/i)).toBeVisible({ timeout: 15_000 });
      await expect(engPage.getByText(/is requesting a session with you/i)).toBeVisible();
      await expect(engPage.getByRole("button", { name: /^Accept$/i })).toBeVisible();
      await expect(engPage.getByRole("button", { name: /^Decline$/i })).toBeVisible();

      // Click Accept → engineer is routed to /staff/session/{id}
      await engPage.getByRole("button", { name: /^Accept$/i }).click();
      await expect(engPage).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, { timeout: 10_000 });

      // Customer's queue card flips to the "Engineer found" state
      await expect(custPage.getByText(/Engineer found/i)).toBeVisible({ timeout: 15_000 });
      await expect(custPage.getByText(/accepted your request/i)).toBeVisible();
    } finally {
      await custCtx.close();
      await engCtx.close();
      await browser.close();
    }
  });

  test("Decline dismisses the card locally; another engineer can still accept", async () => {
    const browser = await chromium.launch();
    const cust = await createTestUser("customer");
    const eng1 = await createTestUser("engineer");
    const eng2 = await createTestUser("engineer");
    const custCtx = await browser.newContext();
    const eng1Ctx = await browser.newContext();
    const eng2Ctx = await browser.newContext();
    const custPage = await custCtx.newPage();
    const eng1Page = await eng1Ctx.newPage();
    const eng2Page = await eng2Ctx.newPage();

    try {
      await admin.from("guest_calls").delete().eq("status", "queued");
      await authPage(custPage, cust);
      await authPage(eng1Page, eng1);
      await authPage(eng2Page, eng2);
      await deleteUserSessions(cust.id);

      await eng1Page.goto("/inbox");
      await eng2Page.goto("/inbox");
      await expect(eng1Page.getByRole("heading", { name: /Welcome back/i })).toBeVisible({ timeout: 10_000 });
      await expect(eng2Page.getByRole("heading", { name: /Welcome back/i })).toBeVisible({ timeout: 10_000 });

      await custPage.goto("/room");

      // Both engineers see the card
      await expect(eng1Page.getByText(/^Incoming request$/i)).toBeVisible({ timeout: 15_000 });
      await expect(eng2Page.getByText(/^Incoming request$/i)).toBeVisible({ timeout: 15_000 });

      // Eng1 declines → card disappears for eng1 only
      await eng1Page.getByRole("button", { name: /^Decline$/i }).click();
      await expect(eng1Page.getByText(/^Incoming request$/i)).toHaveCount(0);

      // Eng2 still sees it, accepts → routed to session
      await expect(eng2Page.getByText(/^Incoming request$/i)).toBeVisible();
      await eng2Page.getByRole("button", { name: /^Accept$/i }).click();
      await expect(eng2Page).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, { timeout: 10_000 });

      // DB confirms eng2 won
      const { data } = await admin.from("guest_calls").select("claimed_by")
        .eq("customer_user_id", cust.id).order("created_at", { ascending: false }).limit(1).single();
      expect((data as { claimed_by: string | null } | null)?.claimed_by).toBe(eng2.id);
    } finally {
      await custCtx.close();
      await eng1Ctx.close();
      await eng2Ctx.close();
      await browser.close();
    }
  });
});
