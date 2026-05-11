/*
 * Test helpers — provision real Supabase auth users + inject sessions
 * into a Playwright browser context via the /api/test/auth route.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

const ENV_PATH = path.resolve(__dirname, "../../.env.local");

const env = (() => {
  const raw = readFileSync(ENV_PATH, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const [k, ...rest] = line.split("=");
    out[k.trim()] = rest.join("=").trim();
  }
  return out;
})();

export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "TestPassword123!";

export type TestUser = {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
};

const createdUserIds: string[] = [];

export async function createTestUser(role: "customer" | "engineer" = "customer"): Promise<TestUser> {
  const email = `relay-pw-${role}-${Date.now()}-${Math.floor(Math.random() * 9999)}@relaytest.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdUserIds.push(data.user.id);

  // Sign in to mint tokens
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const { data: sign, error: signErr } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (signErr || !sign.session) throw signErr ?? new Error("sign in failed");

  // For engineer role: grant via the dev RPC (auth context is the engineer)
  if (role === "engineer") {
    const { error: e } = await sb.rpc("dev_grant_my_role", { _role: "engineer" });
    if (e) throw e;
  }

  return {
    id: data.user.id,
    email,
    accessToken: sign.session.access_token,
    refreshToken: sign.session.refresh_token,
  };
}

export async function authPage(page: Page, user: TestUser) {
  // Navigate to a page first so cookies have a domain to attach to
  if (page.url() === "about:blank") {
    await page.goto("/");
  }
  const res = await page.request.post("/api/test/auth", {
    data: {
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    },
  });
  if (!res.ok()) {
    throw new Error(`auth bypass failed: ${res.status()} ${await res.text()}`);
  }
}

export async function authContext(context: BrowserContext, user: TestUser) {
  const page = await context.newPage();
  await authPage(page, user);
  await page.close();
}

export async function cleanupTestUsers() {
  for (const id of createdUserIds) {
    try { await admin.auth.admin.deleteUser(id); } catch {}
  }
  createdUserIds.length = 0;
}

// Deterministic helpers used by the spec files
export async function getActiveSession(userId: string) {
  const { data } = await admin
    .from("guest_calls")
    .select("*")
    .eq("customer_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function deleteUserSessions(userId: string) {
  await admin.from("guest_calls").delete().eq("customer_user_id", userId);
}

export async function bypassRateLimit(sessionId: string) {
  await admin.from("guest_calls").update({ last_recall_at: null }).eq("id", sessionId);
}
