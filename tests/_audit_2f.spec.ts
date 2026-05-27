import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const NIRAJ = "f519b4f5-8bd3-4c77-8650-c847831376ec";
const IVANOV = "87d01b2b-7141-449e-adc9-57d4c0e47d09";
const BAUER = "462f825f-0000-0000-0000-000000000000"; // resolved at runtime

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

test("2F: callback lands in supervisor queue with SLA breach + reassign works", async ({ browser }) => {
  const { data: bauerRow } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const bauerId = bauerRow.users.find((u) => u.email === "freya.bauer@yopmail.com")!.id;

  await admin.from("engineer_connect_requests").delete().eq("customer_user_id", NIRAJ).eq("status", "pending");
  // Seed an aged callback (40 min old) so SLA-breach (>30 min) is asserted.
  const aged = new Date(Date.now() - 40 * 60_000).toISOString();
  const { data: cr, error: ce } = await admin.from("engineer_connect_requests").insert({
    customer_user_id: NIRAJ, engineer_user_id: IVANOV, status: "pending", message: "AUDIT-2F callback", created_at: aged,
  }).select("id").single();
  if (ce) throw ce;

  try {
    const sCtx = await browser.newContext(); const sp = await sCtx.newPage();
    await magic(sp, "mateo.andersen@yopmail.com");
    await sp.goto("/supervise");
    await expect(sp.getByRole("heading", { name: "Live operations" })).toBeVisible({ timeout: 20000 });
    await cookie(sp);
    const stay = sp.getByRole("button", { name: "Stay off duty" });
    await stay.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (await stay.isVisible().catch(() => false)) await stay.click();
    await stay.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Callback in the supervisor's queue, flagged SLA-breached.
    const card = sp.locator("div.rounded-xl", { hasText: "waiting on" }).filter({ hasText: /SLA breached/ });
    await expect(card.first()).toBeVisible({ timeout: 15000 });
    await sp.screenshot({ path: "tests/_audit_2f_callback_sla.png", fullPage: true });
    console.log("SUPERVISOR sees SLA-breached callback");

    // Reassign to a different pod engineer (freya.bauer).
    await card.first().getByRole("button", { name: "Reassign" }).click();
    await card.first().locator("select").selectOption(bauerId);
    await sp.waitForTimeout(2500);

    const { data: after } = await admin.from("engineer_connect_requests").select("engineer_user_id, status").eq("id", cr!.id).maybeSingle();
    console.log("DB after reassign:", JSON.stringify(after));
    expect((after as { engineer_user_id?: string } | null)?.engineer_user_id).toBe(bauerId);
  } finally {
    await admin.from("engineer_connect_requests").delete().eq("id", cr!.id);
  }
});
