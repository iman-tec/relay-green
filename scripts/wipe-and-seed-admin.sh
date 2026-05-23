#!/usr/bin/env bash
#
# ============================================================================
#  DANGER — FULL DATA WIPE + RESEED SUPER ADMIN
# ============================================================================
#  Deletes EVERY row in EVERY public table (except the `roles` lookup), ALL
#  auth users, and ALL storage objects — then seeds a single super admin:
#      admin@relay.com / Password@12
#
#  Preserves: database schema, the `roles` lookup, storage buckets, and the
#             migration history (supabase_migrations schema).
#
#  This is IRREVERSIBLE. There is no undo.
#
#  Usage:
#    SUPABASE_ACCESS_TOKEN=sbp_xxxxx ./scripts/wipe-and-seed-admin.sh --yes-wipe-everything
#
#  Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
#  Requires a Supabase Management token (sbp_…) in SUPABASE_ACCESS_TOKEN.
#  Requires: bash, curl, jq.
# ============================================================================
set -euo pipefail

PROJECT_REF="vdduelvjrzeczmakxgpn"
ADMIN_EMAIL="admin@relay.com"
ADMIN_PASS="Password@12"
ADMIN_NAME="Relay Admin"

# ---- safety gate -----------------------------------------------------------
if [ "${1:-}" != "--yes-wipe-everything" ]; then
  echo "REFUSING: this DELETES ALL DATA + ALL USERS in project '$PROJECT_REF'."
  echo "It cannot be undone. To proceed, re-run with the explicit flag:"
  echo
  echo "  SUPABASE_ACCESS_TOKEN=sbp_... $0 --yes-wipe-everything"
  exit 1
fi

# ---- credentials -----------------------------------------------------------
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
SUPABASE_URL="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
SERVICE_ROLE_KEY="$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN to a Supabase Management token (sbp_...)}"
: "${SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL not found in .env.local}"
: "${SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not found in .env.local}"

# ---- helper: run SQL via the Management API (errors are objects, ok is []) --
mgmt_sql() {
  local resp
  resp="$(jq -Rs '{query: .}' <<<"$1" \
    | curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
        -H "Content-Type: application/json" --data @-)"
  if echo "$resp" | jq -e 'type=="object"' >/dev/null 2>&1; then
    echo "  SQL error: $resp" >&2
    exit 1
  fi
}

# ---- storage helpers (objects can't be DELETEd via SQL — Supabase guards it) -
# Recursively list every FILE path under a bucket/prefix (folders have id=null).
list_files() {
  local bucket="$1" prefix="$2" resp
  resp="$(curl -s -X POST "$SUPABASE_URL/storage/v1/object/list/$bucket" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn --arg p "$prefix" '{prefix:$p, limit:1000, sortBy:{column:"name",order:"asc"}}')")"
  echo "$resp" | jq -r --arg p "$prefix" '.[]? | select(.id != null) | (if $p=="" then .name else $p+"/"+.name end)'
  for folder in $(echo "$resp" | jq -r '.[]? | select(.id == null) | .name'); do
    local sub; [ -z "$prefix" ] && sub="$folder" || sub="$prefix/$folder"
    list_files "$bucket" "$sub"
  done
}

empty_bucket() {
  local bucket="$1" files arr
  files="$(list_files "$bucket" "")"
  [ -z "$files" ] && { echo "    $bucket: already empty"; return 0; }
  arr="$(echo "$files" | jq -R . | jq -cs .)"
  curl -s -X DELETE "$SUPABASE_URL/storage/v1/object/$bucket" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "$(jq -cn --argjson p "$arr" '{prefixes:$p}')" >/dev/null
  echo "    $bucket: deleted $(echo "$files" | grep -c . ) object(s)"
}

empty_all_buckets() {
  local buckets b
  buckets="$(curl -s "$SUPABASE_URL/storage/v1/bucket" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | jq -r '.[]?.id')"
  for b in $buckets; do empty_bucket "$b"; done
}

echo "==> [1/3] Wiping data (all public tables except 'roles' + all auth users)…"
mgmt_sql "
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'roles'
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', r.tablename);
  END LOOP;
END \$\$;
DELETE FROM auth.users;
"
echo "    wiped public tables + auth users."

# Storage objects can't be removed via SQL — empty buckets via the Storage API.
# Best-effort + non-fatal (orphaned blobs are harmless if this is skipped).
echo "    emptying storage buckets…"
empty_all_buckets || echo "    storage cleanup skipped (non-fatal)"

echo "==> [2/3] Creating super admin ($ADMIN_EMAIL) via Auth Admin API…"
CREATE="$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\",\"email_confirm\":true,\"app_metadata\":{\"password_set\":true},\"user_metadata\":{\"display_name\":\"$ADMIN_NAME\"}}")"
ADMIN_UID="$(echo "$CREATE" | jq -r '.id // empty')"
if [ -z "$ADMIN_UID" ]; then
  echo "  User creation failed: $CREATE" >&2
  exit 1
fi
echo "    admin user id: $ADMIN_UID"

echo "==> [3/3] Granting super_admin role + profile…"
mgmt_sql "
INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded)
SELECT '$ADMIN_UID', '$ADMIN_NAME',
       (SELECT id FROM public.roles WHERE name = 'super_admin'), true
ON CONFLICT (id) DO UPDATE
  SET full_name       = EXCLUDED.full_name,
      primary_role_id = EXCLUDED.primary_role_id,
      is_onboarded    = true;

INSERT INTO public.user_roles (user_id, role_id)
SELECT '$ADMIN_UID', (SELECT id FROM public.roles WHERE name = 'super_admin')
ON CONFLICT (user_id, role_id) DO NOTHING;
"

echo
echo "✅ Done. Database wiped and super admin seeded."
echo "   Email:    $ADMIN_EMAIL"
echo "   Password: $ADMIN_PASS"
echo "   Sign in at /staff/login (use the password option)."
