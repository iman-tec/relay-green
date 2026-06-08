# Phase 0 findings — Partner application page + review-to-provision

> Study before build. Every name below verified against code. Where the brief
> and code disagreed, code wins (noted inline). Read this, approve, then I
> build Phases 1→6.

---

## 1. The reseller-creation path (what "instant provision" must call)

**Handler:** `app/api/admin/resellers/route.ts` — `POST` (line 146). Gated by
`requireSuperAdmin()` (`lib/admin-auth.ts:27`). The full provisioning sequence
already exists end to end:

| Step | Where | Detail |
|------|-------|--------|
| Validate name+email | `route.ts:161-171` | trims, lowercases email, regex check |
| Commission default **20** | `route.ts:173-181` | `commission === undefined \|\| "" ? 20 : Number(...)`, range 0–100 |
| Duplicate-email guard | `route.ts:193-203` | `ilike("email", cleanEmail)` → **409** if a reseller already exists. This is the idempotency anchor. |
| Insert reseller row | `route.ts:207-217` | `reseller_code` auto-filled by DB trigger `resellers_set_code()` (RLC-AB12CD format, `20260521170000_…sql:142`); minutes columns start 0 |
| Send `/partner` login invite | `route.ts:229-243` | `sendInvitationEmail()` (`lib/admin-invite.ts:93`) — Supabase `inviteUserByEmail` + temp password, metadata carries `role_label:"reseller"`, `reseller_id`, `reseller_code` |
| Link profile + role | `route.ts:263-317` | grants `ROLE.reseller`, sets `profiles.reseller_id`, `owner_user_id` |
| Initial minutes (optional) | `route.ts:320-331` | `transfer_to_reseller` RPC; soft-warns on failure (not rolled back) |

**`resellers` columns** (`20260521130000` + `…170000`): `id, name, email`
(nullable, **unique**), `reseller_code` (unique, trigger-set), `commission`
(numeric, **DB default 0** but handler defaults 20 — handler is the live
default), `allocated/used/remaining_minutes`, `owner_user_id`,
`status` (`active`/`suspended`), `created_by_user_id`, `created_at`.

**Provisioning plan (Phase 4):** extract the reseller-creation body into a
shared `provisionReseller(admin, {name, email, commission, actorId})` in
`lib/reseller-provision.ts`; have **both** the existing `POST` route and the new
approve endpoint call it. Idempotency comes free from the existing email
duplicate-guard: if a reseller already exists for the application's email,
approve **links** to it instead of inserting a second — and double-approve is
blocked by the application's own `status` check (`new` → `approved` only once,
guarded in a single UPDATE … WHERE status='new' RETURNING).

**UI caller:** `app/(staff)/admin/v2/_drawers/AddResellerDrawer.tsx` (commission
default `"20"`).

---

## 2. Public-form pattern to mirror (spam + rate-limit + email)

**Reference impl:** `app/api/contact/route.ts` (public, unauthenticated). Reuse
verbatim:

- **Honeypot:** `website` field; non-empty → silent `200` (`route.ts:188-193`).
  Hidden via `.r-honeypot` CSS + `aria-hidden` + `tabIndex=-1` (see
  `app/_marketing/EnterpriseCta.tsx:169`).
- **Rate limit:** in-memory per-IP sliding window, **5 / 10 min**
  (`route.ts:48-63`), IP from `x-forwarded-for` (`route.ts:67-73`). Identical
  copy already in `app/api/enterprise-request/route.ts:32` — so duplicating the
  helper is the established norm, not a smell.
- **Persist:** service-role insert, best-effort (`route.ts:94-113`).
- **Email:** `sendViaResend()` (`route.ts:115-163`) → `api.resend.com/emails`,
  `RESEND_API_KEY`; **fail-soft** when unset (logs lead, still 200). From/to via
  `CONTACT_FROM_EMAIL` / `CONTACT_INBOX_EMAIL`.
- **Consent copy:** checkbox pattern at `ContactForm.tsx:227` ("I consent to
  receive…"). I'll add visible data-use copy near submit per brief.

**Internal team notification** = a Resend email to `CONTACT_INBOX_EMAIL` (this
*is* the existing "notify the team" path; there is no in-app team-notification
table for leads). **Applicant confirmation** = a second Resend email to the
applicant. **Provisioning invite** = `sendInvitationEmail` (Supabase), reused
unchanged. Three distinct sends, two services, all already in the repo.

---

## 3. Marketing clip (reuse, do not re-source)

`app/partner/page.tsx:16-23` — `<video src="/relay-explainer-final-v5.mp4">`,
`poster="/relay-explainer-v6-poster.jpg"`, `aspectRatio:"16 / 10"`. Same source
goes in the `/partner/apply` hero.

---

## 4. Super-admin queue surface

Tabs registered in `app/(staff)/admin/v2/PanelClient.tsx:23-29` (`TABS` array),
rendered `:61-65`, page gated on `ROLE.super_admin` at
`app/(staff)/admin/v2/page.tsx:25`. **Add a `{ key:"applications", label:"Partner
Applications" }` tab + `<ApplicationsTab/>`** — slots in with one array entry +
one render line + one component. Queue data via new
`GET /api/admin/partner-applications` (also `requireSuperAdmin`).

---

## 5. The "Apply" link that started this

`app/partner/page.tsx:47` currently `href="/for-enterprise"` (wrong target).
Phase 3 repoints it to **`/partner/apply`**. Note: that link lives inside
`PartnerProof`, which only renders when `partnerProgramEnabled()` is true
(`page.tsx:72`) — so the login entry-point is already flag-gated. No other
"apply" entry points found.

---

## 6. Flag gating — recommendation

`partnerProgramEnabled()` (`lib/billing/partnerProgram.ts:19`) reads
`NEXT_PUBLIC_PARTNER_PROGRAM`, **on by default** (kill-switch only).

**Recommendation:**
- **Public `/partner/apply` page + submit API: NOT flag-gated** — always
  reachable. It's top-of-funnel marketing; a direct/email/deck link must work
  even if the *portal* is killed mid-incident. It exposes no authed data.
- **Login entry link**: leave as-is — already naturally gated by `PartnerProof`.
- **Provisioning + queue**: gated by `requireSuperAdmin` (role), not the flag —
  approving is an internal action, always available to super-admin.

Net: kill-switch dims the live portal/economics; the sales funnel keeps
capturing applications into the queue. This matches the brief's "the public
apply page itself may need to be reachable regardless of the portal flag."

---

## 7. New schema (additive only)

`partner_applications` (new table, migration in Phase 2):

```
id              uuid pk default gen_random_uuid()
contact_name    text not null
work_email      text not null            -- lowercased
company_name    text not null
company_website text not null
country_region  text not null
clients_text    text not null            -- "who are your clients / what you sell"
heard_about     text                     -- optional
anything_else   text                     -- optional
source          text default 'partner_apply'
status          text not null default 'new'  -- new | approved | rejected
reseller_id     uuid references resellers(id)  -- set on approve
reviewed_by     uuid references profiles(id)
reviewed_at     timestamptz
created_at      timestamptz default now()
```

Duplicate guard: queue flags rows sharing `work_email` (or `company_name`)
with an earlier row — **flag, not block** (brief). Provisioning's own
email-uniqueness on `resellers` is the hard stop against double-provision.

RLS: service-role writes only (insert via API service client like `enquiries`);
no public SELECT. Super-admin reads go through the `requireSuperAdmin` service
client, same as every other admin route.

---

## Open question for you before I build

**Confirmation SLA copy** — the applicant email says "we'll be in touch within
___". Brief leaves `[X]` blank. I'll write **"within two business days"** unless
you say otherwise (the existing contact form promises "within one business
day", so 2 is a safe, honest partner-review SLA). Tell me if you want a
different number.

---

## Build order (unchanged from brief)

2. `partner_applications` migration + `POST /api/partner/apply` (record +
   internal notify + applicant confirmation + honeypot + rate-limit).
3. Public `/partner/apply` page (sell + lean form, brand-correct, all states);
   repoint login link.
4. `ApplicationsTab` + `GET /api/admin/partner-applications` + approve
   (`provisionReseller`, idempotent) + reject (decline email) + audit fields.
5. Lateral gaps (duplicate flag, empty/error states, copy parity with deck).
6. Regression tests, then go-live.

---

## CLOSEOUT — all phases built + verified (2026-06-09)

**Schema (applied to Supabase, ref vdduelvjrzeczmakxgpn):**
`20260608150000_partner_applications.sql` — `partner_applications` table (RLS:
super-admin SELECT only, service-role writes) + `claim_partner_application` RPC
(atomic new→approved/rejected single-fire, the idempotency anchor).

**Capture (Phase 2-3):**
- `POST /api/partner/apply` — honeypot + 5/10min per-IP rate-limit + durable
  row (source of truth) + team-notify + applicant-confirm (Resend, fail-soft).
- `app/partner/apply/` — public sell page (hero clip, 20%-pool economics,
  two-field onboarding, tiers, qualitative proof) + `ApplyForm` (lean, all
  states, consent copy). Login "Apply" link repointed `/for-enterprise` →
  `/partner/apply`.

**Review-to-provision (Phase 4):**
- `lib/reseller-provision.ts` — `provisionReseller()` extracted verbatim from
  the admin create path; `onExisting:"error"` (manual create 409) vs `"link"`
  (approve, no dup). The manual `POST /api/admin/resellers` now calls it too.
- `GET /api/admin/partner-applications` (queue, duplicate-flagged),
  `/[id]/approve` (claim → provision @20% → link, idempotent + rollback on
  provision failure), `/[id]/reject` (claim → decline email).
- `ApplicationsTab` in admin v2 (`PanelClient` TABS).

**Lateral (Phase 5):** duplicate flag (`lib/partner/flagDuplicateApplications.ts`),
empty/error/already-applied states, reject message reflects actual send,
economics copy parity (login proof ↔ apply page ↔ confirm email).

**Verified:**
- tsc / eslint / prettier green on all new files (pre-existing CRLF on
  `app/partner/page.tsx` left untouched).
- Tests: 25 pass — 6 dup-logic (`tests/partner-applications.spec.ts`), 17
  billing, 2 new guards (`/partner/apply` public 200 + login link target).
- Public submit: live row write (`status=new`, `source=partner_apply`) →
  success state; cleaned up.
- Approve→provision: live via a **temp-elevated QA super-admin** —
  provisioned reseller `RLC-NS51SJ` @ 20%, role granted, invite sent, app
  linked+reviewed; double-approve returned `alreadyApproved` with **exactly 1
  reseller** (idempotent). Reject → status `rejected`. **All test mutations
  torn down** (apps + reseller + auth user deleted, super_admin grant revoked).

**Flag gating (decision):** public page + submit unflagged (top-of-funnel, no
authed data); provision/queue gated by `requireSuperAdmin` (role). Confirmed
flag-off leaves existing surfaces byte-identical.
</content>
</invoke>
