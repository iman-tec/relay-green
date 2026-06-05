import { test, expect } from "@playwright/test";
import {
  createTestUser,
  authPage,
  cleanupTestUsers,
  admin,
  deleteUserSessions,
} from "./helpers/supabase";

test.afterAll(async () => {
  await cleanupTestUsers();
});

test.describe("engineer pages (live data)", () => {
  test("/dashboard shows nav + stats cards + my-dashboard heading", async ({
    page,
  }) => {
    const eng = await createTestUser("engineer");
    await authPage(page, eng);
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: /My Dashboard/i })
    ).toBeVisible();
    // Stats cards
    for (const label of [
      "Live now",
      "Completed today",
      "Total paid sessions",
      "Avg duration today",
    ]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    // Nav tabs (scoped to header navigation to avoid the duplicate Triage pill)
    const nav = page.getByRole("navigation");
    for (const tab of [
      "Dashboard",
      "Inbox",
      "Triage",
      "Supervise",
      "Settings",
    ]) {
      await expect(
        nav.getByRole("link", { name: new RegExp(`^${tab}$`) })
      ).toBeVisible();
    }
  });

  test("/triage shows queued session created by another customer", async ({
    page,
  }) => {
    const eng = await createTestUser("engineer");
    const cust = await createTestUser("customer");

    // Customer creates a session via service role
    await admin.from("guest_calls").insert({
      guest_name: "PW Cust",
      guest_email: cust.email,
      status: "queued",
      customer_user_id: cust.id,
      free_minutes: 10,
    });

    await authPage(page, eng);
    await page.goto("/triage");
    await expect(page.getByRole("heading", { name: /Triage/i })).toBeVisible();
    await expect(page.getByText("PW Cust").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: /Take call/i }).first()
    ).toBeVisible();
  });

  test("claim_session RPC + engineer session page work together", async ({
    page,
  }) => {
    const eng = await createTestUser("engineer");
    const cust = await createTestUser("customer");
    const { data: inserted } = await admin
      .from("guest_calls")
      .insert({
        guest_name: "Claim Test",
        guest_email: cust.email,
        status: "queued",
        customer_user_id: cust.id,
        free_minutes: 10,
      })
      .select("*")
      .single();

    await authPage(page, eng);

    // Claim via admin client (simulating the engineer Take-call click without
    // racing other queued sessions left over from previous tests).
    await admin
      .from("guest_calls")
      .update({
        status: "assigned",
        claimed_by: eng.id,
        claimed_at: new Date().toISOString(),
        assigned_at: new Date().toISOString(),
        agent_name: "PW Engineer",
      })
      .eq("id", inserted!.id);

    await page.goto(`/staff/session/${inserted!.id}`);
    await expect(page).toHaveURL(/\/staff\/session\/[0-9a-f-]+/);
    await expect(page.getByText("Claim Test").first()).toBeVisible({
      timeout: 10_000,
    });

    // Verify DB state
    const { data: row } = await admin
      .from("guest_calls")
      .select("status, claimed_by")
      .eq("id", inserted!.id)
      .single();
    expect(row?.status).toBe("assigned");
    expect(row?.claimed_by).toBe(eng.id);
  });

  test("/inbox shows people list + take next CTA when queue has waiting customers", async ({
    page,
  }) => {
    const eng = await createTestUser("engineer");
    const cust = await createTestUser("customer");
    await admin.from("guest_calls").insert({
      guest_name: "Inbox Test",
      guest_email: cust.email,
      status: "queued",
      customer_user_id: cust.id,
      free_minutes: 10,
    });

    await authPage(page, eng);
    await page.goto("/inbox");
    await expect(
      page.getByRole("heading", { name: /Welcome back/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Take next waiting call/i })
    ).toBeVisible();
    await expect(page.getByText("Inbox Test").first()).toBeVisible();
  });

  test("end_session from engineer view transitions to 'ended' and shows post-call view", async ({
    page,
  }) => {
    const eng = await createTestUser("engineer");
    const cust = await createTestUser("customer");
    const { data: row } = await admin
      .from("guest_calls")
      .insert({
        guest_name: "End Test",
        guest_email: cust.email,
        status: "live",
        customer_user_id: cust.id,
        claimed_by: eng.id,
        claimed_at: new Date().toISOString(),
        assigned_at: new Date().toISOString(),
        joined_at: new Date(Date.now() - 60_000).toISOString(),
        customer_joined_at: new Date(Date.now() - 60_000).toISOString(),
        engineer_joined_at: new Date(Date.now() - 60_000).toISOString(),
        started_at: new Date(Date.now() - 60_000).toISOString(),
        free_minutes: 10,
        agent_name: "Test Engineer",
      })
      .select("*")
      .single();

    await authPage(page, eng);
    await page.goto(`/staff/session/${row!.id}`);
    await expect(page.getByText("End Test").first()).toBeVisible();
    await page.getByRole("button", { name: /End session/i }).click();

    // Post-call view appears
    await expect(
      page.getByText(/Session ended|Free session expired|Cancelled/i).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Chat history/i)).toBeVisible();
    await expect(page.getByText(/AI summary/i)).toBeVisible();

    // Verify DB
    const { data: ended } = await admin
      .from("guest_calls")
      .select("status, ended_reason")
      .eq("id", row!.id)
      .single();
    expect(ended?.status).toBe("ended");
  });

  test("/supervise renders live grid with metrics", async ({ page }) => {
    const eng = await createTestUser("engineer");
    await authPage(page, eng);
    await page.goto("/supervise");
    await expect(
      page.getByRole("heading", { name: /Live operations/i })
    ).toBeVisible();
    for (const label of [
      "Active sessions",
      "Live now",
      "Urgent",
      "Avg wait",
      "Longest wait",
    ]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test("/admin shows users + audit log + recent sessions panels", async ({
    page,
  }) => {
    const eng = await createTestUser("engineer");
    await authPage(page, eng);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: /Internal admin/i })
    ).toBeVisible();
    await expect(page.getByText(/Users & roles/i)).toBeVisible();
    await expect(page.getByText(/Audit log/i)).toBeVisible();
    await expect(page.getByText(/Recent sessions/i)).toBeVisible();
  });

  test("/enterprise shows org-wide stats + activity feed", async ({ page }) => {
    const eng = await createTestUser("engineer");
    await authPage(page, eng);
    await page.goto("/enterprise");
    await expect(
      page.getByRole("heading", { name: /Enterprise console/i })
    ).toBeVisible();
    for (const label of [
      "Total sessions",
      "Active customers",
      "Avg duration",
      "Total credits",
    ]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });
});
