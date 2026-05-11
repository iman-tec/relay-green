import { test, expect } from "@playwright/test";
import { createTestUser, authPage, cleanupTestUsers } from "./helpers/supabase";

test.afterAll(async () => { await cleanupTestUsers(); });

test.describe("auth guards", () => {
  test("/room redirects anonymous to /login", async ({ page }) => {
    await page.goto("/room");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/dashboard redirects anonymous to /staff/login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("/triage redirects anonymous to /staff/login", async ({ page }) => {
    await page.goto("/triage");
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("/inbox redirects anonymous to /staff/login", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("authed customer (no staff role) sees Pick role screen on /dashboard", async ({ page }) => {
    const user = await createTestUser("customer");
    await authPage(page, user);
    await page.goto("/dashboard");
    await expect(page.getByText(/Staff access required/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Pick role/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Customer view/i })).toBeVisible();
  });

  test("authed engineer reaches /dashboard", async ({ page }) => {
    const user = await createTestUser("engineer");
    await authPage(page, user);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /My Dashboard/i })).toBeVisible();
  });
});
