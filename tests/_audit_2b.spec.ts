import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const NIRAJ = "f519b4f5-8bd3-4c77-8650-c847831376ec";
const IVANOV = "87d01b2b-7141-449e-adc9-57d4c0e47d09"; // freya.ivanov — engineer in mateo's pod, no live session
const CUST_NAME = "AUDIT-2B Cust";

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

test("2B: engineer claims -> customer 'connecting' + supervisor card flips On-call", async ({ browser }) => {
  // ── Seed: a queued session for the customer + a pending match offer to the engineer ──
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("customer_user_id", NIRAJ).in("status", ["queued", "assigned", "joining", "live", "grace", "ending", "expired_free"]);
  await admin.from("engineer_match_offers").delete().eq("engineer_user_id", IVANOV).eq("status", "pending");

  const { data: intake, error: ie } = await admin.from("client_intakes").insert({
    familiarity: "Semi-Technical", ai_tools_used: "Cursor", developing: "Website",
    technologies: ["react"], declined_by: [], intake_messages: [], issues: ["bug"], environments: ["web"], urgency: "standard",
  }).select("id").single();
  if (ie) throw ie;

  const { data: gc, error: ge } = await admin.from("guest_calls").insert({
    guest_name: CUST_NAME, customer_user_id: NIRAJ, status: "queued",
  }).select("id").single();
  if (ge) throw ge;

  const { error: oe } = await admin.from("engineer_match_offers").insert({
    engineer_user_id: IVANOV, guest_call_id: gc.id, intake_id: intake.id,
    status: "pending", match_score: 90, customer_user_id: NIRAJ,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  });
  if (oe) throw oe;
  console.log("SEED: guest_call", gc.id, "intake", intake.id);

  // ── Supervisor (mateo) — Team tab BEFORE the claim ──
  const sCtx = await browser.newContext(); const sp = await sCtx.newPage();
  await magic(sp, "mateo.andersen@yopmail.com");
  await sp.goto("/supervise");
  await expect(sp.getByRole("heading", { name: "Live operations" })).toBeVisible({ timeout: 20000 });
  await cookie(sp);
  const stay = sp.getByRole("button", { name: "Stay off duty" });
  await stay.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await stay.isVisible().catch(() => false)) await stay.click();
  await stay.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  await sp.getByRole("tab", { name: /team/i }).click();
  await sp.waitForTimeout(2500);
  const onCallBefore = await sp.getByText(`On call · ${CUST_NAME}`).count();
  console.log("SUPERVISOR on-call-for-AUDIT before:", onCallBefore);
  await sp.screenshot({ path: "tests/_audit_2b_supervisor_before.png", fullPage: true });

  // ── Customer (niraj) on /room — should be waiting (queued) ──
  const cCtx = await browser.newContext(); const cp = await cCtx.newPage();
  await magic(cp, "nirajgemawat@yahoo.com");
  await cp.goto("/room");
  await cookie(cp);
  await cp.waitForTimeout(3000);
  await cp.screenshot({ path: "tests/_audit_2b_customer_waiting.png", fullPage: true });

  // ── Engineer (freya.ivanov) — ring appears, click Accept (real accept_match) ──
  const eCtx = await browser.newContext(); const ep = await eCtx.newPage();
  await magic(ep, "freya.ivanov@yopmail.com");
  await ep.goto("/dashboard");
  await cookie(ep);
  await expect(ep.getByText("Incoming match")).toBeVisible({ timeout: 20000 });
  await ep.screenshot({ path: "tests/_audit_2b_engineer_ring.png", fullPage: true });
  await ep.getByRole("button", { name: "Accept" }).click();
  await ep.waitForURL(/\/staff\/session\//, { timeout: 15000 });
  console.log("ENGINEER routed to:", ep.url());

  // ── DB truth: the call is now claimed + assigned to the engineer ──
  await sp.waitForTimeout(1500);
  const { data: claimed } = await admin.from("guest_calls").select("status, claimed_by, pod_id, agent_name").eq("id", gc.id).maybeSingle();
  console.log("CLAIMED:", JSON.stringify(claimed));
  expect(claimed?.status).toBe("assigned");
  expect(claimed?.claimed_by).toBe(IVANOV);

  // ── Supervisor card flips On-call + customer + timer (realtime within poll window) ──
  await expect(sp.getByText(`On call · ${CUST_NAME}`)).toBeVisible({ timeout: 15000 });
  await sp.screenshot({ path: "tests/_audit_2b_supervisor_oncall.png", fullPage: true });
  console.log("SUPERVISOR card flipped On-call · AUDIT-2B Cust");

  // ── Customer sees "{engineer} is connecting with you" ──
  await expect(cp.getByText(/is connecting with you/i)).toBeVisible({ timeout: 15000 });
  await cp.screenshot({ path: "tests/_audit_2b_customer_connecting.png", fullPage: true });
  console.log("CUSTOMER sees engineer-connecting modal");

  // ── Cleanup ──
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("id", gc.id);
  await admin.from("engineer_match_offers").delete().eq("guest_call_id", gc.id);
});
