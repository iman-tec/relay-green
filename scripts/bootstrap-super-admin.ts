/*
 * One-time bootstrap: creates the first Super Admin in Supabase.
 *
 * Prerequisites:
 *   1. The SQL migration `20260513120000_super_admin_role.sql` is applied
 *      (adds 'super_admin' to user_roles check constraint).
 *   2. .env (or .env.local) contains NEXT_PUBLIC_SUPABASE_URL and
 *      SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run with:
 *   npx tsx scripts/bootstrap-super-admin.ts
 *
 * Auth model: email OTP. The Super Admin user is created with email
 * confirmed and no password. They sign in via /staff/login by requesting
 * a 6-digit code that Supabase emails them. Subsequent invites for staff
 * / enterprise admins / customers follow the same email-OTP flow with an
 * initial "Invite User" magic-link email.
 *
 * Idempotent: re-running ensures the user exists, is email-confirmed,
 * and has the super_admin role.
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Load .env.local first (local Supabase stack); then .env as fallback.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// Add entries here to bootstrap additional Super Admins. The script is
// idempotent: existing users keep their id, new ones are created with
// email_confirm=true and no password (email-OTP sign-in only). Order
// doesn't matter; each entry is processed independently.
type SuperAdmin = { email: string; name: string };
// Display names — DO NOT suffix the role here. The role is rendered
// separately by highestRoleLabel() wherever it's surfaced in the UI.
// Earlier entries had "(Super Admin)" appended which double-displayed.
const SUPER_ADMINS: SuperAdmin[] = [
  { email: "madhav.anadkat@thegatewaycorp.com", name: "Madhav Anadkat" },
  { email: "dev.soni@thegatewaycorp.co.in",     name: "Dev Soni"        },
];

// Use SupabaseClient<any> so the .from()/.upsert() helpers don't get
// narrowed to `never[]` — we're talking to a generic Postgres surface
// here and we don't have generated DB types wired up for this script.
type AdminClient = SupabaseClient<any, "public", "public", any, any>;

async function bootstrapOne(admin: AdminClient, entry: SuperAdmin): Promise<void> {
  console.log(`→ Bootstrapping Super Admin: ${entry.email}`);

  // Find or create the auth user.
  let userId: string;
  // Note: listUsers caps at 1000/page; this list approach is fine for the
  // handful of super admins we expect. If the user table grows huge,
  // switch to getUserByEmail or a server-side lookup.
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const match = existing?.users.find(
    (u) => u.email?.toLowerCase() === entry.email.toLowerCase(),
  );

  if (match) {
    userId = match.id;
    console.log(`  → user exists (${userId})`);
    if (match.user_metadata?.display_name !== entry.name) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...(match.user_metadata ?? {}),
          display_name: entry.name,
        },
      });
      if (error) {
        console.warn(`  ! could not refresh display name: ${JSON.stringify(error)}`);
      }
    }
  } else {
    console.log(`  → creating new auth user (no password, email-OTP only)`);
    const { data, error } = await admin.auth.admin.createUser({
      email:         entry.email,
      email_confirm: true,
      user_metadata: { display_name: entry.name },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    console.log(`  → created (${userId})`);
  }

  // Upsert profile so the admin console shows the right name (the
  // handle_new_user trigger derives full_name from email; we override).
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      {
        id:           userId,
        full_name:    entry.name,
        primary_role: "super_admin",
        is_onboarded: true,
      },
      { onConflict: "id" },
    );
  if (profileErr) {
    throw new Error(`Upserting profile failed for ${entry.email}: ${profileErr.message}`);
  }

  // Grant super_admin. Idempotent via unique(user_id, role).
  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "super_admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (roleErr) {
    throw new Error(
      `Granting super_admin failed for ${entry.email}: ${roleErr.message}\n` +
      `Did you apply supabase/migrations/20260513120000_super_admin_role.sql? ` +
      `The check constraint must include 'super_admin'.`,
    );
  }

  console.log(`  ✓ ${entry.email} is super_admin`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const entry of SUPER_ADMINS) {
    await bootstrapOne(admin, entry);
  }

  console.log("");
  console.log(`✓ Bootstrapped ${SUPER_ADMINS.length} Super Admin${SUPER_ADMINS.length === 1 ? "" : "s"}.`);
  console.log(`  Sign in at /staff/login with any of the listed emails → enter the OTP from your inbox.`);
}

main().catch((err) => {
  console.error("✗ Bootstrap failed:", err.message ?? err);
  process.exit(1);
});
