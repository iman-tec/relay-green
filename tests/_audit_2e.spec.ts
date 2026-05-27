import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { authPage } from "./helpers/supabase";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const IVANOV = "87d01b2b-7141-449e-adc9-57d4c0e47d09";

async function magic(page: Page, email: string) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v, error } = await anon.auth.verifyOtp({ type: "email", token_hash: link!.properties!.hashed_token });
  if (error || !v.session) throw error ?? new Error("magic fail " + email);
  await page.goto("/"); await authPage(page, { id: v.user!.id, email: v.user!.email!, accessToken: v.session.access_token, refreshToken: v.session.refresh_token });
}
const cookie = (p: Page) => p.getByRole("button", { name: "Accept & Continue" }).click({ timeout: 8000 }).catch(() => {});

async function waitPresence(target: string, timeoutMs = 20000): Promise<string> {
  const end = Date.now() + timeoutMs;
  let last = "?";
  while (Date.now() < end) {
    const { data } = await admin.from("engineer_profiles").select("presence_state").eq("user_id", IVANOV).maybeSingle();
    last = (data as { presence_state?: string } | null)?.presence_state ?? "?";
    if (last === target) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

test("2E: presence auto-flips online -> busy (on-call) -> online", async ({ browser }) => {
  await admin.from("guest_calls").update({ status: "cancelled" }).eq("claimed_by", IVANOV).in("status", ["assigned", "joining", "live", "grace"]);
  try {
    const eCtx = await browser.newContext(); const ep = await eCtx.newPage();
    await magic(ep, "freya.ivanov@yopmail.com");
    await ep.goto("/dashboard");
    await cookie(ep);
    // mouse activity to ensure markActive fires (counts the engineer as present)
    await ep.mouse.move(200, 200); await ep.mouse.move(400, 300);
    await ep.waitForTimeout(2000);

    // Engineer takes a call → their own browser detects it via realtime → busy.
    // (recompute fires on the onCall false->true transition.)
    const { data: gc } = await admin.from("guest_calls").insert({ guest_name: "AUDIT-2E", claimed_by: IVANOV, status: "live" }).select("id").single();
    const busy = await waitPresence("busy");
    console.log("after claim (on a call):", busy);
    expect(busy).toBe("busy");

    // Call ends → flips back to online (still active at PC).
    await ep.mouse.move(250, 250);
    await admin.from("guest_calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", gc!.id);
    const online2 = await waitPresence("online");
    console.log("after call end:", online2);
    expect(online2).toBe("online");

    await admin.from("guest_calls").delete().eq("id", gc!.id);
  } finally {
    await admin.from("engineer_profiles").update({ is_available: false, presence_state: "offline" }).eq("user_id", IVANOV);
  }
});
