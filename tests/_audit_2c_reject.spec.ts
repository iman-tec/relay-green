import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const QUOTE = "957b98f6-dbcc-4d8a-8269-a254c180f07d"; // niraj's

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

async function resetQuote() {
  await admin.from("project_quote_requests").update({
    status: "quoted", quote_amount_cents: 500000, bid_scope: "Audit reject test", bid_timeline: "2 weeks",
    terms_url: "/legal/contracting-terms", customer_viewed_at: null, customer_response_note: null,
    created_at: new Date().toISOString(),
  }).eq("id", QUOTE);
}
async function openBid(cp: Page) {
  await cp.goto("/room");
  await cookie(cp);
  await expect(cp.getByRole("heading", { name: "Contract management" })).toBeVisible({ timeout: 20000 });
  const section = cp.locator('section:has(h3:has-text("Contract management"))');
  await section.getByRole("button").first().click();
  await expect(cp.getByText(/estimate —/i)).toBeVisible({ timeout: 8000 });
}

test("2C+: customer can Request changes (re-queues for re-bid with a note)", async ({ browser }) => {
  await resetQuote();
  const cCtx = await browser.newContext(); const cp = await cCtx.newPage();
  await magic(cp, "nirajgemawat@yahoo.com");
  await openBid(cp);
  await cp.getByRole("button", { name: "Request changes" }).click();
  await cp.getByPlaceholder("What should change?").fill("Please lower the price and shorten the timeline.");
  await cp.getByRole("button", { name: "Send for revision" }).click();
  await cp.waitForTimeout(2500);
  const { data } = await admin.from("project_quote_requests").select("status, customer_response_note").eq("id", QUOTE).maybeSingle();
  console.log("AFTER request-changes:", JSON.stringify(data));
  expect((data as { status?: string } | null)?.status).toBe("pending");
  expect((data as { customer_response_note?: string } | null)?.customer_response_note).toContain("lower the price");
});

test("2C+: customer can Decline a bid", async ({ browser }) => {
  await resetQuote();
  const cCtx = await browser.newContext(); const cp = await cCtx.newPage();
  await magic(cp, "nirajgemawat@yahoo.com");
  await openBid(cp);
  await cp.getByRole("button", { name: "Decline" }).click();
  await cp.getByPlaceholder("Reason (optional)").fill("Going a different direction.");
  await cp.getByRole("button", { name: "Decline estimate" }).click();
  await cp.waitForTimeout(2500);
  const { data } = await admin.from("project_quote_requests").select("status, customer_response_note").eq("id", QUOTE).maybeSingle();
  console.log("AFTER decline:", JSON.stringify(data));
  expect((data as { status?: string } | null)?.status).toBe("declined");
});
