import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

test("pod supervisor now sees an unclaimed queued (ringing) call", async ({ browser }) => {
  const { data: gc } = await admin.from("guest_calls").insert({ guest_name: "AUDIT-PODQ", status: "queued" }).select("id").single();
  try {
    const sCtx = await browser.newContext(); const sp = await sCtx.newPage();
    await magic(sp, "mateo.andersen@yopmail.com"); // pod supervisor, NOT super_admin
    await sp.goto("/supervise");
    await expect(sp.getByRole("heading", { name: "Live operations" })).toBeVisible({ timeout: 20000 });
    await cookie(sp);
    const stay = sp.getByRole("button", { name: "Stay off duty" });
    await stay.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    if (await stay.isVisible().catch(() => false)) await stay.click();
    await stay.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await expect(sp.getByText("AUDIT-PODQ").first()).toBeVisible({ timeout: 15000 });
    console.log("POD SUPERVISOR sees the unclaimed queued call");
  } finally {
    await admin.from("guest_calls").delete().eq("id", gc!.id);
  }
});
