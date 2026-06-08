import { test, expect } from "@playwright/test";
import { createTestUser, authPage, cleanupTestUsers } from "./helpers/supabase";

test.afterAll(async () => {
  await cleanupTestUsers();
});

test.describe("auth guards", () => {
  test("/room redirects anonymous to /login", async ({ page }) => {
    await page.goto("/room");
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test("/dashboard redirects anonymous to /staff", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/staff(\?|$)/);
  });

  test("/triage redirects anonymous to /staff", async ({ page }) => {
    await page.goto("/triage");
    await expect(page).toHaveURL(/\/staff(\?|$)/);
  });

  test("/inbox redirects anonymous to /staff", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/staff(\?|$)/);
  });

  test("/supervise redirects anonymous to /staff", async ({ page }) => {
    await page.goto("/supervise");
    await expect(page).toHaveURL(/\/staff(\?|$)/);
  });

  test("/reseller/v2 redirects anonymous to /partner", async ({ page }) => {
    await page.goto("/reseller/v2");
    await expect(page).toHaveURL(/\/partner(\?|$)/);
  });

  // The authed partner portal moved to /partner/v2; it's a protected prefix, so
  // an anonymous hit bounces to the /partner login (NOT bare /partner, which is
  // the login page itself).
  test("/partner/v2 redirects anonymous to /partner", async ({ page }) => {
    await page.goto("/partner/v2");
    await expect(page).toHaveURL(/\/partner(\?|$)/);
  });

  test("/enterprise/v2 redirects anonymous to /business", async ({ page }) => {
    await page.goto("/enterprise/v2");
    await expect(page).toHaveURL(/\/business(\?|$)/);
  });

  test("/department/v2 redirects anonymous to /business", async ({ page }) => {
    await page.goto("/department/v2");
    await expect(page).toHaveURL(/\/business(\?|$)/);
  });

  test("/staff/login (legacy URL) redirects to /staff", async ({ page }) => {
    await page.goto("/staff/login");
    await expect(page).toHaveURL(/\/staff(\?|$)/);
  });

  test("anonymous can load each public login surface (200)", async ({
    page,
  }) => {
    for (const url of ["/login", "/staff", "/partner", "/business"]) {
      const res = await page.goto(url);
      expect(res?.status(), `${url} should return 200`).toBe(200);
    }
  });

  test("authed customer (no staff role) sees Pick role screen on /dashboard", async ({
    page,
  }) => {
    const user = await createTestUser("customer");
    await authPage(page, user);
    await page.goto("/dashboard");
    await expect(page.getByText(/Staff access required/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Pick role/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Customer view/i })
    ).toBeVisible();
  });

  test("authed engineer reaches /dashboard", async ({ page }) => {
    const user = await createTestUser("engineer");
    await authPage(page, user);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /My Dashboard/i })
    ).toBeVisible();
  });
});
