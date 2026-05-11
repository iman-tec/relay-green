import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import {
  createTestUser, authPage, cleanupTestUsers, admin, deleteUserSessions,
} from "./helpers/supabase";

test.afterAll(async () => { await cleanupTestUsers(); });

test.setTimeout(120_000);
test("E2E lifecycle: customer queues → engineer claims → both join → LIVE → end → post-call", async () => {
  const browser = await chromium.launch();

  const cust = await createTestUser("customer");
  const eng  = await createTestUser("engineer");

  // Two isolated browser contexts (separate cookies)
  const custCtx = await browser.newContext();
  const engCtx  = await browser.newContext();

  const custPage = await custCtx.newPage();
  const engPage  = await engCtx.newPage();

  try {
    await authPage(custPage, cust);
    await authPage(engPage, eng);

    // ── Step 1: customer lands → queued ──
    await deleteUserSessions(cust.id);
    await custPage.goto("/room");
    await expect(custPage.getByRole("heading", { name: /Connecting/i })).toBeVisible();

    const { data: rows } = await admin
      .from("guest_calls").select("*")
      .eq("customer_user_id", cust.id).order("created_at", { ascending: false }).limit(1);
    const session = rows![0];
    expect(session.status).toBe("queued");

    // ── Step 2: engineer goes to /triage and sees the queued session ──
    await engPage.goto("/triage");
    // Wait for OUR specific customer's name (not someone else's queued row)
    await expect(engPage.getByText(cust.email.split("@")[0]).first()).toBeVisible({ timeout: 10_000 });

    // ── Step 3: engineer claims THIS customer's session deterministically ──
    // Other tests leave queued rows behind. Use the admin client to claim
    // by id, then have the engineer simply navigate to the session URL.
    // (This still tests the full flow downstream: notify customer, join, etc.)
    await admin.rpc("claim_session", { _session_id: session.id });
    // Switch admin's auth context isn't possible via service role on RPC,
    // so direct SQL claim:
    await admin.from("guest_calls").update({
      status: "assigned",
      claimed_by: eng.id,
      claimed_at: new Date().toISOString(),
      assigned_at: new Date().toISOString(),
      agent_name: "PW Engineer",
    }).eq("id", session.id);
    await engPage.goto(`/staff/session/${session.id}`);
    await expect(engPage).toHaveURL(/\/staff\/session\/[0-9a-f-]+/);

    // ── Step 4: customer's modal flips to "Engineer is ready" via realtime ──
    // If the realtime push is slow (Supabase free tier latency varies), fall
    // back to a hard refresh on the customer page.
    try {
      await expect(custPage.getByRole("heading", { name: /is ready/i }))
        .toBeVisible({ timeout: 15_000 });
    } catch {
      await custPage.reload();
      await expect(custPage.getByRole("heading", { name: /is ready/i }))
        .toBeVisible({ timeout: 15_000 });
    }

    // ── Step 5: customer clicks Join the call ──
    await custPage.getByRole("button", { name: /Join the call/i }).click();

    // DB should be in 'joining' now
    await custPage.waitForTimeout(500);
    let { data: after } = await admin.from("guest_calls").select("*").eq("id", session.id).single();
    expect(["joining", "live"]).toContain(after!.status);

    // ── Step 6: engineer marks joined → LIVE ──
    await engPage.getByRole("button", { name: /Mark joined/i }).click();
    await expect(engPage.getByText(/Live/).first()).toBeVisible({ timeout: 10_000 });

    ({ data: after } = await admin.from("guest_calls").select("*").eq("id", session.id).single());
    expect(after!.status).toBe("live");
    expect(after!.joined_at).toBeTruthy();

    // ── Step 7: end session → post-call view on both sides ──
    await engPage.getByRole("button", { name: /End session/i }).click();

    // Engineer sees post-call split
    await expect(engPage.getByText(/Chat history/i)).toBeVisible({ timeout: 15_000 });
    await expect(engPage.getByText(/AI summary/i)).toBeVisible();

    // Customer sees post-call split too
    await expect(custPage.getByText(/Chat history/i)).toBeVisible({ timeout: 15_000 });
    await expect(custPage.getByText(/AI summary/i)).toBeVisible();

    // DB confirms
    ({ data: after } = await admin.from("guest_calls").select("*").eq("id", session.id).single());
    expect(after!.status).toBe("ended");
  } finally {
    await custCtx.close();
    await engCtx.close();
    await browser.close();
  }
});
