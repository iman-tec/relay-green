import { test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  await page.goto("/"); await authPage(page, { id: v!.user!.id, email: v!.user!.email!, accessToken: v!.session!.access_token, refreshToken: v!.session!.refresh_token });
}

const WIDTHS = [768, 900, 1024, 1180, 1280, 1366, 1440, 1680, 1920];

const NIRAJ = "f519b4f5-8bd3-4c77-8650-c847831376ec";

test("D4 probe: measure horizontal overflow on /room at each width", async ({ browser }) => {
  // Seed a LIVE session so the full 3-column layout (rail + main + chat) renders.
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("customer_user_id", NIRAJ).in("status", ["queued", "assigned", "joining", "live", "grace", "ending", "expired_free"]);
  const { data: gc } = await admin.from("guest_calls").insert({ guest_name: "AUDIT-D4", customer_user_id: NIRAJ, status: "live", assigned_at: new Date().toISOString() }).select("id").single();

  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await magic(p, "nirajgemawat@yahoo.com");
  await p.goto("/room");
  await p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2500);
  for (const w of WIDTHS) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    const overflow = m.scrollW - m.clientW;
    // Measure the main work pane width (the flex-1 column between rail + chat).
    const mainW = await p.locator("main").first().evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => -1);
    const asideCount = await p.locator("aside").count();
    console.log(`W=${w}: OVERFLOW=${overflow}px ${overflow > 0 ? "❌" : "✓"} | main=${mainW}px | asides=${asideCount}`);
    await p.screenshot({ path: `tests/_audit_d4_${w}.png`, fullPage: false });
  }
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("id", gc!.id);
});
