import { test, expect } from "@playwright/test";
import {
  createTestUser, authPage, cleanupTestUsers, admin, deleteUserSessions,
  SUPABASE_URL, ANON_KEY,
} from "./helpers/supabase";
import { createClient } from "@supabase/supabase-js";

async function exhaustEntitlement(userId: string) {
  await admin.from("customer_entitlements").upsert({
    customer_user_id: userId,
    free_session_consumed_at: new Date().toISOString(),
    paid_minutes_remaining: 0,
  });
  await admin.from("credit_wallets").upsert({ user_id: userId, balance: 0 });
}

async function creditPaidMinutes(userId: string, minutes: number) {
  await admin.from("customer_entitlements").upsert({
    customer_user_id: userId,
    free_session_consumed_at: new Date().toISOString(),
    paid_minutes_remaining: minutes,
  });
  await admin.from("credit_wallets").upsert({ user_id: userId, balance: minutes });
}

test.afterAll(async () => { await cleanupTestUsers(); });

test.describe("paywall + entitlement lifecycle", () => {
  // Case 1 — fresh customer lands → free quota available, no paywall, sidebar empty.
  test("fresh customer sees 10 min free available and no past sessions", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await admin.from("customer_entitlements").delete().eq("customer_user_id", user.id);
    await admin.from("credit_wallets").delete().eq("user_id", user.id);
    await authPage(page, user);
    await page.goto("/room");

    // Sidebar profile chip shows the free entitlement
    await expect(page.getByText(/10 min free available/i)).toBeVisible({ timeout: 10_000 });
    // Sidebar has no past sessions
    await expect(page.getByText(/Your past sessions will appear here/i)).toBeVisible();
    // Paywall is NOT open
    await expect(page.getByText(/Three phases\. One team\./i)).toHaveCount(0);
  });

  // Case 1.1 — ended session shows in sidebar regardless of duration.
  test("ended session appears in sidebar even after only seconds", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await admin.from("customer_entitlements").delete().eq("customer_user_id", user.id);
    await admin.from("credit_wallets").delete().eq("user_id", user.id);
    await authPage(page, user);
    await page.goto("/room");

    // Wait for queued row to exist (under load the RPC + realtime can take a beat)
    await expect(page.getByRole("heading", { name: /Connecting/i })).toBeVisible({ timeout: 20_000 });
    const { data: rows } = await admin
      .from("guest_calls").select("*")
      .eq("customer_user_id", user.id).order("created_at", { ascending: false }).limit(1);
    const session = rows![0];

    // End it directly via admin (simulates cust ending early or buffer expiring)
    await admin.from("guest_calls").update({
      status: "ended",
      ended_at: new Date().toISOString(),
      ended_reason: "customer_ended",
      duration_minutes: 1,
      ai_summary_title: "Test ended session",
    }).eq("id", session.id);
    // Stamp the entitlement as consumed (this is what end_session does)
    await admin.from("customer_entitlements").upsert({
      customer_user_id: user.id,
      free_session_consumed_at: new Date().toISOString(),
    });

    // Refresh and verify the sidebar now shows the past session
    await page.reload();
    await expect(page.getByText(/Test ended session/i)).toBeVisible({ timeout: 10_000 });
    // Profile chip flips to "Free used"
    await expect(page.getByText(/Free used/i)).toBeVisible();
  });

  // Case 2 — exhausted customer auto-sees the paywall on landing, no raw error.
  test("exhausted customer lands and paywall auto-opens (no NO_ENTITLEMENT toast)", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await exhaustEntitlement(user.id);
    await authPage(page, user);
    await page.goto("/room");

    await expect(page.getByText(/Three phases\. One team\./i)).toBeVisible({ timeout: 10_000 });
    // The raw NO_ENTITLEMENT string must NEVER appear on screen
    await expect(page.getByText("NO_ENTITLEMENT")).toHaveCount(0);
    // Sidebar profile chip flips to "Free used"
    await expect(page.getByText(/Free used/i)).toBeVisible();
  });

  // After closing the paywall, clicking "+ New session" must re-open it
  // (not crash, not show an error toast).
  test("closing paywall and clicking + New session re-opens it", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await exhaustEntitlement(user.id);
    await authPage(page, user);
    await page.goto("/room");

    await expect(page.getByText(/Three phases\. One team\./i)).toBeVisible({ timeout: 10_000 });
    // Close via the X button (aria-label="Close")
    await page.getByRole("button", { name: /Close/i }).click();
    await expect(page.getByText(/Three phases\. One team\./i)).toHaveCount(0);

    // Now click + New session
    await page.getByRole("button", { name: /New session/i }).click();
    await expect(page.getByText(/Three phases\. One team\./i)).toBeVisible({ timeout: 5_000 });
  });

  // Profile chip is clickable when entitlement is exhausted → opens paywall.
  test("profile chip click opens paywall when exhausted", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await exhaustEntitlement(user.id);
    await authPage(page, user);
    await page.goto("/room");

    // Paywall auto-opens — close it first
    await expect(page.getByText(/Three phases\. One team\./i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Close/i }).click();
    await expect(page.getByText(/Three phases\. One team\./i)).toHaveCount(0);

    // Click the profile chip — re-opens
    const profileBtn = page.locator("button", { hasText: user.email.split("@")[0] }).last();
    await profileBtn.click();
    await expect(page.getByText(/Three phases\. One team\./i)).toBeVisible({ timeout: 5_000 });
  });

  // Stripe success URL handshake: ?relay_paid=base → "Payment received" toast + URL cleaned.
  test("Stripe success URL shows payment-received toast and cleans URL", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await admin.from("customer_entitlements").delete().eq("customer_user_id", user.id);
    // Simulate the webhook already credited the wallet
    await admin.from("credit_wallets").upsert({ user_id: user.id, balance: 60 });
    await authPage(page, user);
    await page.goto("/room?relay_paid=base");

    await expect(page.getByText(/Payment received/i)).toBeVisible({ timeout: 10_000 });
    // URL must have been cleaned
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain("relay_paid");
    // Profile chip shows paid balance
    await expect(page.getByText(/60 min paid/i)).toBeVisible({ timeout: 8_000 });
  });

  // Paid customer with credit can start a new session (no paywall blocking).
  test("paid customer can start new session without paywall", async ({ page }) => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await creditPaidMinutes(user.id, 120);
    await authPage(page, user);
    await page.goto("/room");

    await expect(page.getByText(/120 min paid/i)).toBeVisible({ timeout: 10_000 });
    // First land auto-creates a queued session because they have paid credit
    await expect(page.getByRole("heading", { name: /Connecting/i })).toBeVisible({ timeout: 20_000 });
    const { data: rows } = await admin
      .from("guest_calls").select("status")
      .eq("customer_user_id", user.id).order("created_at", { ascending: false }).limit(1);
    expect(rows![0].status).toBe("queued");
  });

  // RPC entitlement gate: ensure get_or_create_active_customer_session raises NO_ENTITLEMENT
  // for an exhausted customer. (Backend correctness — confirms client-side gate matches DB.)
  test("RPC raises NO_ENTITLEMENT for exhausted customer", async () => {
    const user = await createTestUser("customer");
    await deleteUserSessions(user.id);
    await exhaustEntitlement(user.id);
    const sb = createClient(SUPABASE_URL, ANON_KEY);
    await sb.auth.setSession({ access_token: user.accessToken, refresh_token: user.refreshToken });
    const { error } = await sb.rpc("get_or_create_active_customer_session");
    expect(error?.message ?? "").toMatch(/NO_ENTITLEMENT/);
  });

  // Bug 11 fix: short live sessions (<30s) do NOT consume the free quota.
  test("ended session under 30s does NOT consume free quota", async () => {
    const cust = await createTestUser("customer");
    const eng  = await createTestUser("engineer");
    await deleteUserSessions(cust.id);
    await admin.from("customer_entitlements").delete().eq("customer_user_id", cust.id);

    // Build a live session directly via admin (we already exercise the UI
    // claim/join path in engineer-flow.spec.ts — here we're testing only
    // the end_session consumption gate).
    const { data: insertData } = await admin.from("guest_calls").insert({
      guest_name: "short-call test",
      guest_email: cust.email,
      status: "live",
      customer_user_id: cust.id,
      claimed_by: eng.id,
      free_minutes: 10,
      // joined_at < 30s ago — duration on end will be ~5s
      joined_at: new Date(Date.now() - 5_000).toISOString(),
      started_at: new Date(Date.now() - 5_000).toISOString(),
      engineer_joined_at: new Date(Date.now() - 5_000).toISOString(),
      customer_joined_at: new Date(Date.now() - 5_000).toISOString(),
    }).select().single();
    const sessionId = (insertData as { id: string }).id;

    // End as the engineer
    const sb = createClient(SUPABASE_URL, ANON_KEY);
    await sb.auth.setSession({ access_token: eng.accessToken, refresh_token: eng.refreshToken });
    const { error: endErr } = await sb.rpc("end_session", { _session_id: sessionId, _reason: "customer_ended" });
    expect(endErr).toBeNull();

    const { data: ent } = await admin
      .from("customer_entitlements")
      .select("free_session_consumed_at")
      .eq("customer_user_id", cust.id)
      .maybeSingle();
    expect((ent as { free_session_consumed_at: string | null } | null)?.free_session_consumed_at ?? null).toBeNull();
  });

  // Bug 11 fix: live sessions ≥ 30s DO consume the free quota.
  test("ended session ≥ 30s DOES consume free quota", async () => {
    const cust = await createTestUser("customer");
    const eng  = await createTestUser("engineer");
    await deleteUserSessions(cust.id);
    await admin.from("customer_entitlements").delete().eq("customer_user_id", cust.id);

    const longAgo = new Date(Date.now() - 90_000).toISOString();   // 1.5 min ago
    const { data: insertData } = await admin.from("guest_calls").insert({
      guest_name: "long-call test",
      guest_email: cust.email,
      status: "live",
      customer_user_id: cust.id,
      claimed_by: eng.id,
      free_minutes: 10,
      joined_at: longAgo,
      started_at: longAgo,
      engineer_joined_at: longAgo,
      customer_joined_at: longAgo,
    }).select().single();
    const sessionId = (insertData as { id: string }).id;

    const sb = createClient(SUPABASE_URL, ANON_KEY);
    await sb.auth.setSession({ access_token: eng.accessToken, refresh_token: eng.refreshToken });
    const { error: endErr } = await sb.rpc("end_session", { _session_id: sessionId, _reason: "engineer_ended" });
    expect(endErr).toBeNull();

    const { data: ent } = await admin
      .from("customer_entitlements")
      .select("free_session_consumed_at, free_session_id")
      .eq("customer_user_id", cust.id)
      .maybeSingle();
    const e = ent as { free_session_consumed_at: string | null; free_session_id: string | null } | null;
    expect(e?.free_session_consumed_at).toBeTruthy();
    expect(e?.free_session_id).toBe(sessionId);
  });
});
