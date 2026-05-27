import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const IVANOV = "87d01b2b-7141-449e-adc9-57d4c0e47d09";
const POD = "28477d95-fb4f-414c-bc6f-250a14bdfea5"; // mateo's pod (ivanov is an engineer in it)

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

test("2D: escalation round-trip — engineer raises -> supervisor resolves -> engineer sees resolved", async ({ browser }) => {
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("claimed_by", IVANOV).in("status", ["assigned", "joining", "live", "grace"]);
  const { data: gc } = await admin.from("guest_calls").insert({ guest_name: "AUDIT-2D", claimed_by: IVANOV, status: "live", pod_id: POD, assigned_at: new Date().toISOString() }).select("id").single();
  const SID = gc!.id;
  await admin.from("session_escalations").delete().eq("session_id", SID);

  try {
    // ── Engineer raises an escalation via the session-page UI ──
    const eCtx = await browser.newContext(); const ep = await eCtx.newPage();
    await magic(ep, "freya.ivanov@yopmail.com");
    await ep.goto(`/staff/session/${SID}`);
    await cookie(ep);
    await ep.getByRole("button", { name: "Escalate to supervisor" }).click({ timeout: 20000 });
    await ep.getByPlaceholder("What's happening?").fill("AUDIT-2D blocker — need help");
    await ep.getByRole("button", { name: "Raise" }).click();
    await expect(ep.getByText(/Raised — your supervisor/i)).toBeVisible({ timeout: 8000 });
    console.log("ENGINEER raised escalation");

    const { data: open } = await admin.from("session_escalations").select("id, status, reason").eq("session_id", SID).order("created_at", { ascending: false }).limit(1).maybeSingle();
    console.log("DB after raise:", JSON.stringify(open));
    expect((open as { status?: string } | null)?.status).toBe("open");

    // ── Supervisor sees it in the Act-now rail + resolves (window.prompt note) ──
    const sCtx = await browser.newContext(); const sp = await sCtx.newPage();
    await magic(sp, "mateo.andersen@yopmail.com");
    await sp.goto("/supervise");
    await expect(sp.getByRole("heading", { name: "Live operations" })).toBeVisible({ timeout: 20000 });
    await cookie(sp);
    const stay = sp.getByRole("button", { name: "Stay off duty" });
    await stay.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (await stay.isVisible().catch(() => false)) await stay.click();
    await stay.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    await expect(sp.getByText("AUDIT-2D blocker — need help").first()).toBeVisible({ timeout: 15000 });
    await sp.screenshot({ path: "tests/_audit_2d_supervisor_escalation.png", fullPage: true });
    console.log("SUPERVISOR sees the escalation");

    sp.on("dialog", (d) => d.accept("Resolved by audit — guided the engineer"));
    const escCard = sp.locator("div.rounded-xl", { hasText: "AUDIT-2D blocker — need help" });
    await escCard.getByRole("button", { name: "Resolve" }).click();
    await sp.waitForTimeout(2500);

    const { data: resolved } = await admin.from("session_escalations").select("status, resolution_note, resolved_by").eq("session_id", SID).order("created_at", { ascending: false }).limit(1).maybeSingle();
    console.log("DB after resolve:", JSON.stringify(resolved));
    expect((resolved as { status?: string } | null)?.status).toBe("resolved");

    // ── Engineer side reflects the resolution (after reload — see audit note) ──
    await ep.reload();
    await cookie(ep);
    await expect(ep.getByText(/Escalation · resolved/i)).toBeVisible({ timeout: 15000 });
    console.log("ENGINEER session view shows resolved");
  } finally {
    await admin.from("session_escalations").delete().eq("session_id", SID);
    await admin.from("guest_calls").delete().eq("id", SID);
  }
});
