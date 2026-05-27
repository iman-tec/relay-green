import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const QUOTE = "957b98f6-dbcc-4d8a-8269-a254c180f07d";

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
async function password(page: Page, email: string, pw: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: v, error } = await anon.auth.signInWithPassword({ email, password: pw });
  if (error || !v.session) throw error ?? new Error("pw fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

test("2C: supervisor scopes -> customer inbox -> engineer sees it", async ({ browser }) => {
  await admin.from("project_quote_requests").update({ status: "pending", quote_amount_cents: null, bid_scope: null, responded_at: null, customer_viewed_at: null }).eq("id", QUOTE);

  // ── Supervisor (Lucia, password) scopes + bids ──
  const sCtx = await browser.newContext(); const sp = await sCtx.newPage();
  await password(sp, "lucia.rossi@yopmail.com", "RelaySup@2026");
  await sp.goto("/supervise");
  await expect(sp.getByRole("heading", { name: "Live operations" })).toBeVisible({ timeout: 20000 });
  await cookie(sp);
  await sp.getByRole("button", { name: "Stay off duty" }).click({ timeout: 8000 }).catch(() => {});
  // Find the AUDIT-2C estimation row (newest → first "Review & bid")
  await sp.getByRole("button", { name: "Review & bid" }).first().click({ force: true });
  await expect(sp.getByText(/Scope go-live estimate|Bid · Go-live/i)).toBeVisible({ timeout: 8000 });
  // OVERLAY AUDIT: is the dialog the only top overlay? capture + check backdrop
  await sp.screenshot({ path: "tests/_audit_2c_supervisor_modal.png", fullPage: true });
  const dialogs = await sp.getByRole("dialog").count();
  console.log("SUPERVISOR open dialogs:", dialogs);
  await sp.getByPlaceholder("5000").fill("7500");
  await sp.getByRole("dialog").getByRole("button", { name: /Send bid|Update bid/ }).click();
  await expect(sp.getByRole("dialog")).toHaveCount(0, { timeout: 10000 });

  const { data: afterBid } = await admin.from("project_quote_requests").select("status, quote_amount_cents, terms_url").eq("id", QUOTE).maybeSingle();
  console.log("AFTER BID:", JSON.stringify(afterBid));

  // ── Customer sees it in Contract management ──
  const cCtx = await browser.newContext(); const cp = await cCtx.newPage();
  await magic(cp, "nirajgemawat@yahoo.com");
  await cp.goto("/room");
  await cookie(cp);
  await expect(cp.getByRole("heading", { name: "Contract management" })).toBeVisible({ timeout: 20000 });
  const section = cp.locator('section:has(h3:has-text("Contract management"))');
  await section.getByRole("button").first().click();
  await expect(cp.getByText(/Go-live estimate/i)).toBeVisible({ timeout: 8000 });
  await expect(cp.getByText("General Terms & Conditions")).toBeVisible();
  await expect(cp.getByRole("button", { name: /Accept & pay/ })).toBeVisible();
  await expect(cp.getByRole("button", { name: /Ask for appointment/ })).toBeVisible();
  await cp.screenshot({ path: "tests/_audit_2c_customer.png", fullPage: true });

  // ── Engineer sees the resulting proposal ──
  const eCtx = await browser.newContext(); const ep = await eCtx.newPage();
  await magic(ep, "freya.bauer@yopmail.com");
  await ep.goto("/inbox"); await cookie(ep);
  await expect(ep.getByRole("heading", { name: "Quote requests" })).toBeVisible({ timeout: 20000 });
  await expect(ep.getByText("Bid sent").first()).toBeVisible({ timeout: 8000 });

  // ── T&C reachable ──
  const tc = await cp.request.get("/legal/contracting-terms");
  console.log("T&C status:", tc.status());
});
