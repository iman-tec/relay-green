/*
 * End-to-end test of the engineer side of the queue: claim → start video →
 * both-joined → live → end. Each step is exercised through the real UI of
 * the engineer (and where it matters, the customer) — no admin shortcuts
 * except to pre-stamp Zoom metadata (so the test doesn't need real Zoom
 * credentials).
 */

import { test, expect, chromium, type Page } from "@playwright/test";
import {
  createTestUser,
  authPage,
  cleanupTestUsers,
  admin,
  deleteUserSessions,
  getActiveSession,
} from "./helpers/supabase";

test.afterAll(async () => {
  await cleanupTestUsers();
});
test.setTimeout(120_000);

async function preStampZoom(sessionId: string) {
  // Bypass the Zoom edge function — pretend a meeting was minted so the
  // engineer's "Join video" button is the path under test (not "Start video"
  // which would require real Zoom credentials).
  await admin
    .from("guest_calls")
    .update({
      zoom_meeting_id: "9999999999",
      zoom_join_url: "https://zoom.us/j/9999999999",
      zoom_start_url: "https://zoom.us/s/9999999999?zak=fake",
    })
    .eq("id", sessionId);
}

async function dbStatus(sessionId: string): Promise<string> {
  const { data } = await admin
    .from("guest_calls")
    .select("status")
    .eq("id", sessionId)
    .single();
  return (data as { status: string } | null)?.status ?? "missing";
}

test.describe("engineer attends queued sessions (full UI flow)", () => {
  // The main two-sided lifecycle.
  test("engineer claims via /inbox → both join → live → engineer ends", async () => {
    const browser = await chromium.launch();
    const cust = await createTestUser("customer");
    const eng = await createTestUser("engineer");
    const custCtx = await browser.newContext();
    const engCtx = await browser.newContext();
    const custPage = await custCtx.newPage();
    const engPage = await engCtx.newPage();

    try {
      await authPage(custPage, cust);
      await authPage(engPage, eng);

      // ── Step 1: customer lands → queued ─────────────────────────────────
      // Clear stale queued rows from prior tests so the engineer's
      // notification card is guaranteed to target THIS customer.
      await admin.from("guest_calls").delete().eq("status", "queued");
      await deleteUserSessions(cust.id);
      await custPage.goto("/room");
      await expect(
        custPage.getByRole("heading", { name: /Connecting/i })
      ).toBeVisible({ timeout: 20_000 });

      const session = await getActiveSession(cust.id);
      expect(session?.status).toBe("queued");
      await preStampZoom(session!.id);

      // ── Step 2: engineer navigates to /inbox; the incoming-request card pops
      await engPage.goto("/inbox");
      await expect(engPage.getByText(/^Incoming request$/i)).toBeVisible({
        timeout: 15_000,
      });

      // ── Step 3: engineer clicks Accept on the notification card ──────────
      await engPage.getByRole("button", { name: /^Accept$/i }).click();
      await expect(engPage).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, {
        timeout: 10_000,
      });

      // DB confirms the claim
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("guest_calls")
              .select("status, claimed_by")
              .eq("id", session!.id)
              .single();
            const row = data as {
              status: string;
              claimed_by: string | null;
            } | null;
            return `${row?.status}|${row?.claimed_by}`;
          },
          { timeout: 10_000 }
        )
        .toBe(`assigned|${eng.id}`);

      // ── Step 4: engineer clicks Join video → mark_joined fires ──────────
      // (Zoom embed mount will fail silently with the fake meeting id, but
      // the markJoined RPC fires synchronously on click — the customer's
      // IncomingCallModal renders based on engineer_joined_at, not on the
      // embed's join state.)
      await engPage.getByRole("button", { name: /Join video/i }).click();

      // ── Step 5: customer sees the incoming-call modal ───────────────────
      try {
        await expect(
          custPage.getByRole("heading", { name: /is calling/i })
        ).toBeVisible({ timeout: 15_000 });
      } catch {
        // Realtime can be slow — one reload retries from the row state.
        await custPage.reload();
        await expect(
          custPage.getByRole("heading", { name: /is calling/i })
        ).toBeVisible({ timeout: 10_000 });
      }

      // ── Step 6: customer clicks "Join the call" → mark_joined(customer) ─
      await custPage.getByRole("button", { name: /Join the call/i }).click();

      // ── Step 7: DB transitions to live once both stamps land ────────────
      await expect
        .poll(() => dbStatus(session!.id), { timeout: 15_000 })
        .toBe("live");

      // ── Step 8: engineer clicks End session in the header pill ──────────
      await engPage
        .getByRole("button", { name: /^End session$/i })
        .first()
        .click();
      // Confirmation modal — click the modal's End session button
      await engPage
        .getByRole("button", { name: /^End session$/i })
        .last()
        .click();

      // ── Step 9: DB confirms ended ───────────────────────────────────────
      await expect
        .poll(() => dbStatus(session!.id), { timeout: 15_000 })
        .toBe("ended");
    } finally {
      await custCtx.close();
      await engCtx.close();
      await browser.close();
    }
  });

  // Engineer can end a pre-live (just-claimed) session — release path.
  test("engineer ends session before video starts → status=ended", async () => {
    const browser = await chromium.launch();
    const cust = await createTestUser("customer");
    const eng = await createTestUser("engineer");
    const custCtx = await browser.newContext();
    const engCtx = await browser.newContext();
    const custPage = await custCtx.newPage();
    const engPage = await engCtx.newPage();

    try {
      await authPage(custPage, cust);
      await authPage(engPage, eng);

      await admin.from("guest_calls").delete().eq("status", "queued");
      await deleteUserSessions(cust.id);
      await custPage.goto("/room");
      await expect(
        custPage.getByRole("heading", { name: /Connecting/i })
      ).toBeVisible({ timeout: 20_000 });
      const session = await getActiveSession(cust.id);

      // Engineer accepts via the push notification card
      await engPage.goto("/inbox");
      await expect(engPage.getByText(/^Incoming request$/i)).toBeVisible({
        timeout: 15_000,
      });
      await engPage.getByRole("button", { name: /^Accept$/i }).click();
      await expect(engPage).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, {
        timeout: 10_000,
      });

      // Engineer ends right away (no Start video click)
      await engPage
        .getByRole("button", { name: /^End session$/i })
        .first()
        .click();
      await engPage
        .getByRole("button", { name: /^End session$/i })
        .last()
        .click();

      await expect
        .poll(() => dbStatus(session!.id), { timeout: 15_000 })
        .toBe("ended");
    } finally {
      await custCtx.close();
      await engCtx.close();
      await browser.close();
    }
  });

  // /inbox "Take next" button claims the head of the queue.
  test("/inbox Take next waiting call claims the queued session", async ({
    page,
  }) => {
    const cust = await createTestUser("customer");
    const eng = await createTestUser("engineer");

    // Use a fresh customer in a separate auth context — log in as engineer here
    const browser = await chromium.launch();
    const custCtx = await browser.newContext();
    const custPage = await custCtx.newPage();

    try {
      // Clear stale queued sessions from prior runs / manual dev usage so the
      // engineer's "Take next" picks OUR customer (not someone else who was
      // accidentally left queued).
      await admin.from("guest_calls").delete().eq("status", "queued");

      await authPage(custPage, cust);
      await deleteUserSessions(cust.id);
      await custPage.goto("/room");
      await expect(
        custPage.getByRole("heading", { name: /Connecting/i })
      ).toBeVisible({ timeout: 20_000 });
      const session = await getActiveSession(cust.id);

      await authPage(page, eng);
      await page.goto("/inbox");
      // The global incoming-request card pops first — dismiss it so we can
      // exercise the manual Take-next path under it.
      await expect(page.getByText(/^Incoming request$/i)).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /Dismiss/i }).click();
      // Wait for the queue to show this customer's row before clicking Take next.
      await expect(
        page.getByText(cust.email.split("@")[0]).first()
      ).toBeVisible({ timeout: 15_000 });
      await page
        .getByRole("button", { name: /Take next waiting call/i })
        .click();
      await expect(page).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, {
        timeout: 10_000,
      });

      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("guest_calls")
              .select("claimed_by")
              .eq("id", session!.id)
              .single();
            return (data as { claimed_by: string | null } | null)?.claimed_by;
          },
          { timeout: 10_000 }
        )
        .toBe(eng.id);
    } finally {
      await custCtx.close();
      await browser.close();
    }
  });

  // Bug 10 fix: when two engineers both press Take next at the same time,
  // the loser should silently retry and claim the SECOND queued session.
  test("/inbox Take next race: both engineers claim, no one gets stranded", async () => {
    // Two queued customers
    const cust1 = await createTestUser("customer");
    const cust2 = await createTestUser("customer");
    const eng1 = await createTestUser("engineer");
    const eng2 = await createTestUser("engineer");
    await deleteUserSessions(cust1.id);
    await deleteUserSessions(cust2.id);
    await admin.from("guest_calls").delete().eq("status", "queued");

    const [{ data: s1 }, { data: s2 }] = await Promise.all([
      admin
        .from("guest_calls")
        .insert({
          guest_name: "Race-1",
          guest_email: cust1.email,
          status: "queued",
          customer_user_id: cust1.id,
          free_minutes: 10,
        })
        .select()
        .single(),
      admin
        .from("guest_calls")
        .insert({
          guest_name: "Race-2",
          guest_email: cust2.email,
          status: "queued",
          customer_user_id: cust2.id,
          free_minutes: 10,
        })
        .select()
        .single(),
    ]);
    const s1Id = (s1 as { id: string }).id;
    const s2Id = (s2 as { id: string }).id;

    const browser = await chromium.launch();
    const eng1Ctx = await browser.newContext();
    const eng2Ctx = await browser.newContext();
    const eng1Page = await eng1Ctx.newPage();
    const eng2Page = await eng2Ctx.newPage();

    try {
      await authPage(eng1Page, eng1);
      await authPage(eng2Page, eng2);
      await eng1Page.goto("/inbox");
      await eng2Page.goto("/inbox");
      // Dismiss the push-notification card on both engineers — this test
      // covers the manual Take-next path, which the card normally pre-empts.
      await expect(eng1Page.getByText(/^Incoming request$/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(eng2Page.getByText(/^Incoming request$/i)).toBeVisible({
        timeout: 15_000,
      });
      await eng1Page.getByRole("button", { name: /Dismiss/i }).click();
      await eng2Page.getByRole("button", { name: /Dismiss/i }).click();

      // Both inboxes have 2 queued people visible
      await expect(
        eng1Page.getByText(/relay-pw-customer-/i).first()
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        eng2Page.getByText(/relay-pw-customer-/i).first()
      ).toBeVisible({ timeout: 15_000 });

      // Both click "Take next" at the same time
      await Promise.all([
        eng1Page
          .getByRole("button", { name: /Take next waiting call/i })
          .click(),
        eng2Page
          .getByRole("button", { name: /Take next waiting call/i })
          .click(),
      ]);

      // Each ends up on a different session URL (no one stranded)
      await expect(eng1Page).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, {
        timeout: 15_000,
      });
      await expect(eng2Page).toHaveURL(/\/staff\/session\/[0-9a-f-]+/, {
        timeout: 15_000,
      });

      // DB: both sessions claimed, by different engineers
      const { data: rows } = await admin
        .from("guest_calls")
        .select("id, claimed_by, status")
        .in("id", [s1Id, s2Id]);
      const list = (rows ?? []) as Array<{
        id: string;
        claimed_by: string | null;
        status: string;
      }>;
      expect(list.length).toBe(2);
      const claimers = list
        .map((r) => r.claimed_by)
        .filter((x): x is string => !!x)
        .sort();
      expect(claimers.length).toBe(2);
      expect(new Set(claimers).size).toBe(2);
      expect(new Set(claimers)).toEqual(new Set([eng1.id, eng2.id]));
    } finally {
      await eng1Ctx.close();
      await eng2Ctx.close();
      await browser.close();
    }
  });

  // Two engineers race to claim the same session — only one wins.
  test("concurrent claim: only one of two engineers wins", async () => {
    const cust = await createTestUser("customer");
    const eng1 = await createTestUser("engineer");
    const eng2 = await createTestUser("engineer");

    await deleteUserSessions(cust.id);
    // Create a queued session directly as the customer via service role
    // (RPC needs auth.uid() — easier to insert directly for this race test)
    const { data: insertData, error: insertErr } = await admin
      .from("guest_calls")
      .insert({
        guest_name: "Race test",
        guest_email: cust.email,
        status: "queued",
        customer_user_id: cust.id,
        free_minutes: 10,
      })
      .select()
      .single();
    expect(insertErr).toBeNull();
    const sessionId = (insertData as { id: string }).id;

    const browser = await chromium.launch();
    const eng1Ctx = await browser.newContext();
    const eng2Ctx = await browser.newContext();
    const eng1Page = await eng1Ctx.newPage();
    const eng2Page = await eng2Ctx.newPage();

    try {
      await authPage(eng1Page, eng1);
      await authPage(eng2Page, eng2);

      // Both call claim_session in parallel
      const [r1, r2] = await Promise.all([
        eng1Page.request
          .post(`/api/test/echo`, { failOnStatusCode: false })
          .then(() => null)
          .catch(() => null),
        eng2Page.request
          .post(`/api/test/echo`, { failOnStatusCode: false })
          .then(() => null)
          .catch(() => null),
      ]);
      void r1;
      void r2;

      // Use the supabase JS client directly via each user's token
      const { createClient } = await import("@supabase/supabase-js");
      const { SUPABASE_URL, ANON_KEY } = await import("./helpers/supabase");
      const sb1 = createClient(SUPABASE_URL, ANON_KEY);
      const sb2 = createClient(SUPABASE_URL, ANON_KEY);
      await sb1.auth.setSession({
        access_token: eng1.accessToken,
        refresh_token: eng1.refreshToken,
      });
      await sb2.auth.setSession({
        access_token: eng2.accessToken,
        refresh_token: eng2.refreshToken,
      });

      const [c1, c2] = await Promise.all([
        sb1.rpc("claim_session", { _session_id: sessionId }),
        sb2.rpc("claim_session", { _session_id: sessionId }),
      ]);
      const successes = [c1, c2].filter((r) => !r.error).length;
      const errors = [c1, c2].filter((r) => r.error);
      expect(successes).toBe(1);
      expect(errors[0]?.error?.message ?? "").toMatch(/ALREADY_CLAIMED/);

      const { data: final } = await admin
        .from("guest_calls")
        .select("claimed_by, status")
        .eq("id", sessionId)
        .single();
      const f = final as { claimed_by: string | null; status: string } | null;
      expect([eng1.id, eng2.id]).toContain(f?.claimed_by);
      expect(f?.status).toBe("assigned");
    } finally {
      await eng1Ctx.close();
      await eng2Ctx.close();
      await browser.close();
    }
  });
});
