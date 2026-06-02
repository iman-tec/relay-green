import { test, expect } from "@playwright/test";

test.describe("public pages render", () => {
  test("landing page shows brand + Try Relay CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Build with AI/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Try Relay/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible();
  });

  test("/login renders OTP form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByPlaceholder(/you@company.com/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Send code/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Already have a code/i })).toBeVisible();
  });

  test("/staff/login shows OTP form + role quick-pick", async ({ page }) => {
    await page.goto("/staff/login");
    await expect(page.getByRole("heading", { name: /Staff sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder(/you@relay.green/i)).toBeVisible();
    for (const role of ["Engineer", "Supervisor", "Internal Admin", "Enterprise Admin"]) {
      await expect(page.getByRole("button", { name: new RegExp(role) })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Sign in here/i })).toBeVisible();
  });

  test("Try Relay button navigates to /login", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Try Relay/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });
});

