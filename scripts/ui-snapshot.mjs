/*
 * ui-snapshot.mjs — UI-diff safety net for the RoomClient refactor.
 *
 * Logs in as the QA customer, drives /room into side-effect-free states, and
 * captures a normalized DOM skeleton (dynamic content masked) + screenshot per
 * state. Golden baseline is captured BEFORE a change; after each change we
 * re-capture and diff. Behavior-preserving refactors → empty diff.
 *
 *   UI_LABEL=baseline node scripts/ui-snapshot.mjs
 *   UI_LABEL=after    node scripts/ui-snapshot.mjs
 *   UI_DUMP=1         node scripts/ui-snapshot.mjs        # also dump clickables
 *   node scripts/ui-diff.mjs baseline after
 *
 * Creds: qa/test-accounts.json (gitignored) → .customer; never hardcoded here.
 * Self-stability: capture twice on UNCHANGED code, diff → must be empty before
 * trusting it.
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(path.join(ROOT, file), "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const i = s.indexOf("=");
      out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return out;
}
const env = { ...loadEnv(".env"), ...loadEnv(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE = env.UI_BASE || "https://10.0.1.207:3000";
const LABEL = env.UI_LABEL || "baseline";
const DUMP = env.UI_DUMP === "1";

// QA creds from gitignored qa/test-accounts.json (audit convention) or env.
const USER = (() => {
  try {
    const j = JSON.parse(readFileSync(path.join(ROOT, "qa/test-accounts.json"), "utf8"));
    if (j.customer?.email) return j.customer;
  } catch {}
  if (env.QA_CUSTOMER_EMAIL && env.QA_CUSTOMER_PASSWORD)
    return { email: env.QA_CUSTOMER_EMAIL, password: env.QA_CUSTOMER_PASSWORD };
  throw new Error("No customer creds: add qa/test-accounts.json or QA_CUSTOMER_* env");
})();

// ── normalization: mask everything that legitimately varies run-to-run ───────
function normalizeHtml(html) {
  let h = html;
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");
  h = h.replace(/<iframe\b[^>]*stripe[^>]*>[\s\S]*?<\/iframe>/gi, "");
  h = h.replace(/<iframe\b[^>]*stripe[^>]*\/?>/gi, "");
  h = h.replace(/<!--[\s\S]*?-->/g, "");
  // Unseen-count badges drift (live data + opening a view clears its watermark):
  // strip "(N new)" from aria-labels and the count-badge spans (e.g. "7", "9+").
  h = h.replace(/\s*\(\d+\s+new\)/gi, "");
  h = h.replace(
    /<span\b(?=[^>]*\brounded-full\b)(?=[^>]*\btabular-nums\b)[^>]*>\s*\d+\+?\s*<\/span>/gi,
    "⟦badge⟧"
  );
  h = h.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "⟦uuid⟧");
  h = h.replace(/blob:[^"'\s)]+/g, "⟦blob⟧");
  h = h.replace(/data:[a-z/+;=A-Za-z0-9]+/g, "⟦data⟧");
  h = h.replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "⟦iso⟧");
  h = h.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "⟦clock⟧");
  h = h.replace(/\b\d+\s+(sec|second|min|minute|hour|hr|day|week|month|year)s?\s+ago\b/gi, "⟦ago⟧");
  h = h.replace(/\b\d+\s*[smhdwy]\s+ago\b/gi, "⟦ago⟧");
  h = h.replace(/\b(just now|now|yesterday|today)\b/gi, "⟦rel⟧");
  h = h.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(,?\s*\d{4})?/gi, "⟦date⟧");
  h = h.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/gi, "⟦day⟧");
  h = h.replace(/>\s*</g, ">\n<");
  return h.trim();
}

async function mintSession() {
  const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword(USER);
  if (error || !data.session) throw new Error(error?.message || "no session");
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

async function capture(page, dir, name) {
  await page.waitForTimeout(900);
  const html = await page.locator("body").first().evaluate((el) => el.outerHTML);
  writeFileSync(path.join(dir, `${name}.html`), normalizeHtml(html));
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => {});
  console.log(`  captured ${name}`);
}

async function dumpClickables(page) {
  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], [data-testid]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), testid: el.getAttribute("data-testid"), aria: el.getAttribute("aria-label"), text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60) });
    }
    return out;
  });
  console.log(`\n  --- clickables (${items.length}) ---`);
  for (const it of items) console.log(`   <${it.tag}${it.role ? ` role=${it.role}` : ""}>${it.testid ? ` testid=${it.testid}` : ""}${it.aria ? ` aria="${it.aria}"` : ""}${it.text ? ` "${it.text}"` : ""}`);
}

async function main() {
  const dir = path.join(ROOT, "perf", `ui-${LABEL}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`\nui-snapshot label=${LABEL} base=${BASE}\n`);

  const session = await mintSession();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const inj = await ctx.request.post(`${BASE}/api/test/auth`, { data: session, ignoreHTTPSErrors: true });
  if (!inj.ok()) throw new Error(`inject ${inj.status()}`);
  const page = await ctx.newPage();

  await page.goto(BASE + "/room", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  const cookieBtn = page.locator('button:has-text("Accept & Continue")');
  if (await cookieBtn.count()) await cookieBtn.first().click().catch(() => {});

  // Side-effect-free states only — never click connect / call / pick-engineer.
  const STATES = [
    { name: "01_landing", action: async () => {} },
    { name: "02_scheduled", action: async (p) => p.locator('button[aria-label^="Scheduled"]').first().click() },
    { name: "03_contracts", action: async (p) => p.locator('button[aria-label^="Contracts"]').first().click() },
    { name: "04_notifications", action: async (p) => p.locator('button[aria-label^="Notifications"]').first().click() },
    { name: "05_account", action: async (p) => p.locator('button:has-text("min paid")').first().click() },
    { name: "06_project", action: async (p) => p.locator('button:has-text("PlatePal")').first().click() },
  ];

  for (const st of STATES) {
    try {
      await page.goto(BASE + "/room", { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(3000);
      await st.action(page);
      await page.waitForTimeout(2000);
      await capture(page, dir, st.name);
      if (DUMP && st.name === "01_landing") await dumpClickables(page);
    } catch (e) {
      console.log(`  !! ${st.name} failed: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\n→ wrote perf/ui-${LABEL}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
