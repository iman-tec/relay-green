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
import { createClient } from "@supabase/supabase-js";

// Load .env.local first (local Supabase stack); then .env as fallback.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPER_ADMIN_EMAIL = "madhav.anadkat@thegatewaycorp.com";
const SUPER_ADMIN_NAME  = "Madhav Anadkat (Super Admin)";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`→ Bootstrapping Super Admin: ${SUPER_ADMIN_EMAIL}`);

  // Find or create the auth user.
  let userId: string;
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const match = existing?.users.find(
    (u) => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase(),
  );

  if (match) {
    userId = match.id;
    console.log(`  → user exists (${userId})`);
    // If display_name drifted, refresh it. Otherwise leave the auth
    // record alone — we don't need to touch email_confirm here.
    if (match.user_metadata?.display_name !== SUPER_ADMIN_NAME) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...(match.user_metadata ?? {}),
          display_name: SUPER_ADMIN_NAME,
        },
      });
      if (error) {
        console.warn(
          `  ! could not refresh display name: ${JSON.stringify(error)}`,
        );
      }
    }
  } else {
    console.log(`  → creating new auth user (no password, email-OTP only)`);
    const { data, error } = await admin.auth.admin.createUser({
      email:         SUPER_ADMIN_EMAIL,
      email_confirm: true,
      user_metadata: { display_name: SUPER_ADMIN_NAME },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    console.log(`  → created (${userId})`);
  }

  // Upsert profile row so the admin console shows the correct display name
  // (the handle_new_user trigger derives full_name from email; we want our
  // explicit name to win).
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      {
        id:           userId,
        full_name:    SUPER_ADMIN_NAME,
        primary_role: "super_admin",
        is_onboarded: true,
      },
      { onConflict: "id" },
    );
  if (profileErr) {
    throw new Error(`Upserting profile failed: ${profileErr.message}`);
  }

  // Grant super_admin role. Idempotent via unique(user_id, role).
  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "super_admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (roleErr) {
    throw new Error(
      `Granting super_admin failed: ${roleErr.message}\n` +
      `Did you apply supabase/migrations/20260513120000_super_admin_role.sql ` +
      `via the Dashboard SQL Editor? The check constraint must include 'super_admin'.`,
    );
  }

  console.log("");
  console.log("✓ Super Admin ready.");
  console.log(`  Email: ${SUPER_ADMIN_EMAIL}`);
  console.log(`  Sign-in: http://localhost:3001/staff/login → enter email → check Inbucket`);
  console.log(`           (local emails: http://127.0.0.1:54324)`);
}

main().catch((err) => {
  console.error("✗ Bootstrap failed:", err.message ?? err);
  process.exit(1);
});
