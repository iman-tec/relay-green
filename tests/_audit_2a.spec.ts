import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const NIRAJ = "f519b4f5-8bd3-4c77-8650-c847831376ec";
const IVANOV = "87d01b2b-7141-449e-adc9-57d4c0e47d09";
const CUST_NAME = "AUDIT-2A Cust";

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

test("2A: customer request -> matcher rings engineer + customer ringing + ops queue + fall-through", async ({ browser }) => {
  // Make ivanov the single available engineer so the matcher pick is deterministic.
  await admin.from("engineer_profiles").update({ is_available: true }).eq("user_id", IVANOV);
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("customer_user_id", NIRAJ).in("status", ["queued", "assigned", "joining", "live", "grace", "ending", "expired_free"]);
  await admin.from("engineer_match_offers").delete().eq("engineer_user_id", IVANOV).neq("status", "accepted");

  try {
    const { data: gc, error: ge } = await admin.from("guest_calls").insert({ guest_name: CUST_NAME, customer_user_id: NIRAJ, status: "queued" }).select("id").single();
    if (ge) throw ge;
    const { data: intake, error: ie } = await admin.from("client_intakes").insert({
      familiarity: "Semi-Technical", ai_tools_used: "Cursor", developing: "Website",
      technologies: ["react"], declined_by: [], intake_messages: [], issues: ["bug"], environments: ["web"], urgency: "standard",
      guest_call_id: gc.id, customer_user_id: NIRAJ,
    }).select("id").single();
    if (ie) throw ie;

    // ── (1) Matcher produces an offer (this is what the intake wizard calls) ──
    const { data: offers, error: me } = await admin.rpc("match_engineer", { _intake_id: intake.id });
    if (me) throw me;
    const offerRows = (offers ?? []) as { engineer_user_id: string; status: string }[];
    console.log("MATCH offers:", JSON.stringify(offerRows));
    expect(offerRows.length).toBeGreaterThanOrEqual(1);
    expect(offerRows.some((o) => o.engineer_user_id === IVANOV)).toBeTruthy();

    // ── (2) Customer matching screen rings ──
    const cCtx = await browser.newContext(); const cp = await cCtx.newPage();
    await magic(cp, "nirajgemawat@yahoo.com");
    await cp.goto(`/intake/matching/${intake.id}`);
    await cookie(cp);
    await expect(cp.getByText(/Ringing your engineers/i)).toBeVisible({ timeout: 20000 });
    await cp.screenshot({ path: "tests/_audit_2a_customer_ringing.png", fullPage: true });
    console.log("CUSTOMER sees Ringing screen");

    // ── (3) Engineer ivanov sees the incoming-match ring ──
    const eCtx = await browser.newContext(); const ep = await eCtx.newPage();
    await magic(ep, "freya.ivanov@yopmail.com");
    await ep.goto("/dashboard");
    await cookie(ep);
    await expect(ep.getByText("Incoming match")).toBeVisible({ timeout: 20000 });
    console.log("ENGINEER ivanov sees Incoming match ring");

    // ── (4) Ops/super-admin waiting queue shows the queued session ──
    const sCtx = await browser.newContext(); const sp = await sCtx.newPage();
    await magic(sp, "admin@relay.com");
    await sp.goto("/supervise");
    await cookie(sp);
    await sp.getByRole("button", { name: "Stay off duty" }).click({ timeout: 4000 }).catch(() => {});
    await expect(sp.getByText(CUST_NAME).first()).toBeVisible({ timeout: 20000 });
    await sp.screenshot({ path: "tests/_audit_2a_ops_queue.png", fullPage: true });
    console.log("OPS (super_admin) sees queued session in the board");

    // ── (5) Fall-through: pull-queue (list_queue filter) hides while ringing, surfaces on expiry ──
    const hiddenSql = async () => {
      const { data } = await admin.from("guest_calls").select("id").eq("id", gc.id).eq("status", "queued");
      const live = await admin.from("engineer_match_offers").select("id").eq("guest_call_id", gc.id).eq("status", "pending").gt("expires_at", new Date().toISOString());
      return { queued: (data ?? []).length, livePendingOffers: (live.data ?? []).length };
    };
    const before = await hiddenSql();
    console.log("BEFORE expiry (pull-queue should be hidden — has live pending offer):", JSON.stringify(before));
    expect(before.livePendingOffers).toBeGreaterThanOrEqual(1); // ringing → hidden from list_queue

    await admin.from("engineer_match_offers").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("guest_call_id", gc.id).eq("status", "pending");
    const after = await hiddenSql();
    console.log("AFTER expiry (pull-queue should surface it — no live pending offer):", JSON.stringify(after));
    expect(after.queued).toBe(1);
    expect(after.livePendingOffers).toBe(0); // falls through to pull queue (list_queue)

    // cleanup
    await admin.from("guest_calls").update({ status: "cancelled" }).eq("id", gc.id);
    await admin.from("engineer_match_offers").delete().eq("guest_call_id", gc.id);
  } finally {
    await admin.from("engineer_profiles").update({ is_available: false }).eq("user_id", IVANOV);
  }
});
