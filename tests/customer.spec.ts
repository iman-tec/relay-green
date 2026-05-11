import { test, expect } from "@playwright/test";
import {
  createTestUser, authPage, cleanupTestUsers,
  getActiveSession, deleteUserSessions, bypassRateLimit, admin,
} from "./helpers/supabase";

test.afterAll(async () => { await cleanupTestUsers(); });

test.describe("customer /room", () => {
  test("creates a queued session on first land", async ({ page }) => {
    const user = await createTestUser("customer");
    await authPage(page, user);
    await page.goto("/room");

    // Connecting modal renders
    await expect(page.getByRole("heading", { name: /Connecting you with the best engineer/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Call for engineer/i })).toBeVisible();

    // Verify DB state
    const session = await getActiveSession(user.id);
    expect(session?.status).toBe("queued");
    expect(session?.recall_count).toBe(0);
  });

  test("recall button increments count and escalates to urgent at >= 3", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await authPage(page, user);
    await page.goto("/room");
    await expect(page.getByRole("heading", { name: /Connecting/i })).toBeVisible();

    // First click — should succeed
    await page.getByRole("button", { name: /Call for engineer/i }).click();

    // Wait for the recall to register; UI shows "Recalled 1 time"
    await expect(page.getByText(/Recalled 1 time/i)).toBeVisible({ timeout: 10_000 });

    // Bypass rate limit and recall twice more via DB direct + UI click
    const session = await getActiveSession(user.id);
    expect(session?.recall_count).toBe(1);

    await bypassRateLimit(session!.id);
    await page.getByRole("button", { name: /Recall engineer/i }).click();
    await expect(page.getByText(/Recalled 2 times/i)).toBeVisible({ timeout: 10_000 });

    await bypassRateLimit(session!.id);
    await page.getByRole("button", { name: /Recall engineer/i }).click();
    await expect(page.getByText(/Recalled 3 times/i)).toBeVisible({ timeout: 10_000 });

    // Urgency banner should appear
    await expect(page.getByText(/Urgent priority/i)).toBeVisible();

    // DB confirms
    const after = await getActiveSession(user.id);
    expect(after?.recall_count).toBe(3);
    expect(after?.urgency).toBe("urgent");
  });

  test("rate-limited recall shows cooldown message", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await authPage(page, user);
    await page.goto("/room");
    await expect(page.getByRole("heading", { name: /Connecting/i })).toBeVisible();

    // First click
    await page.getByRole("button", { name: /Call for engineer/i }).click();
    await expect(page.getByText(/Recalled 1 time/i)).toBeVisible({ timeout: 10_000 });

    // Within 30s — button should show cooldown text
    await expect(page.getByRole("button", { name: /Wait \d+s before recalling/ })).toBeVisible({ timeout: 5_000 });
  });

  test("cancel button transitions session to cancelled", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await authPage(page, user);
    await page.goto("/room");
    await expect(page.getByRole("heading", { name: /Connecting/i })).toBeVisible();

    // X (close) button on the modal
    await page.getByRole("button", { name: /^Close$/i }).click();

    // Cancel transitions the session via cancel_customer_session RPC
    // Wait for DB to settle
    await page.waitForTimeout(800);
    const session = await getActiveSession(user.id);
    expect(session?.status).toBe("cancelled");
  });

  test("when engineer claims, customer sees 'Engineer is ready' modal", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await authPage(page, user);
    await page.goto("/room");
    await expect(page.getByRole("heading", { name: /Connecting/i })).toBeVisible();

    const session = await getActiveSession(user.id);

    // Simulate engineer claim from server side
    await admin.from("guest_calls").update({
      status: "assigned",
      claimed_by: user.id, // any uuid works for this UI test
      assigned_at: new Date().toISOString(),
      agent_name: "Test Engineer",
    }).eq("id", session!.id);

    // Realtime should update; modal flips to "Engineer is ready".
    // Fall back to a reload if the broadcast lag exceeds 15s.
    try {
      await expect(page.getByRole("heading", { name: /is ready/i }))
        .toBeVisible({ timeout: 15_000 });
    } catch {
      await page.reload();
      await expect(page.getByRole("heading", { name: /is ready/i }))
        .toBeVisible({ timeout: 15_000 });
    }
    await expect(page.getByRole("button", { name: /Join the call/i })).toBeVisible();
  });
});
