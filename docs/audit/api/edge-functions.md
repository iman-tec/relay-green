# Edge Functions — Phase 3 audit

> Non-destructive audit. Source read-only. All 27 Supabase edge functions in
> `supabase/functions/` documented below, grouped by domain. `_shared` is a
> helper module (not a function) — documented in the preamble.
>
> **`verify_jwt` map** comes from
> [`supabase/config.toml`](../../../supabase/config.toml). Supabase defaults
> `verify_jwt = ON` for any function NOT listed there. The hosted project's
> per-function setting can be overridden in the Dashboard / at deploy
> (`--no-verify-jwt`), which this audit cannot observe — flags below assume the
> committed config.toml is authoritative.
>
> `verify_jwt = false` in config.toml (13 functions): `start-guest-call`,
> `summarize-guest-call`, `regenerate-guest-brief`, `create-guest-checkout`,
> `payments-webhook`, `restart-guest-zoom`, `zoom-webhook`, `end-zoom-meeting`,
> `summarize-project`, `summarize-customer`, `zoom-sdk-signature`,
> `relay-stripe-webhook`, `score-session-health`. Everything else defaults ON.
>
> **Correction to ground-truth §6**: the "AI (Anthropic)" group is **not
> Anthropic**. Every model call is OpenAI (`gpt-4o-mini`, `whisper-1`) except
> `regenerate-guest-brief`, which calls **Groq** (`llama-3.3-70b-versatile`).
> No Anthropic / Claude API call exists in any edge function. The `score-
> session-health` header comment says "OpenAI-backed" but the cron script
> comment says GROQ — the code calls OpenAI.

## Preamble — `_shared/stripe.ts`

[`_shared/stripe.ts`](../../../supabase/functions/_shared/stripe.ts) — imported
by `create-credits-checkout`, `create-guest-checkout`, `credit-relay-payment`
(indirectly), and `payments-webhook`.

- `getConnectionApiKey(env)` — returns `STRIPE_SANDBOX_API_KEY` or
  `STRIPE_LIVE_API_KEY` per `env`.
- `createStripeClient(env)` — Stripe SDK `stripe@22.0.2`, pinned
  `apiVersion: "2026-03-25.dahlia"`, fetch HTTP client (Deno).
- `verifyWebhook(req, env)` (`:27-75`) — **manual Stripe signature
  verification** (the SDK's `constructEvent` is not used). Parses
  `stripe-signature`, extracts `t` + `v1`, rejects if `age > 300s`
  (`:54-55`), recomputes HMAC-SHA256 over `${t}.${body}` and compares to the
  `v1` list (`:71-72`). Secret resolves
  `STRIPE_WEBHOOK_SECRET ?? PAYMENTS_{SANDBOX,LIVE}_WEBHOOK_SECRET`. Throws
  (no fail-open) if the secret or signature is missing. **Sound.**

---

# Payments / Stripe (×7)

### `create-credits-checkout`
[index.ts](../../../supabase/functions/create-credits-checkout/index.ts)

- **Trigger**: client `functions.invoke`. **No active caller found** in
  `app/`/`lib/` — appears dormant (credit-package flow superseded by the
  minute-pack `create-relay-checkout`). verify_jwt = ON.
- **Auth**: requires `Authorization: Bearer` + `userClient.auth.getUser()`
  (`:22-39`). Then service-role client for the package lookup + Stripe.
- **Inputs**: `{ package_code: string, return_url: string, env?: "live"|"sandbox" }`.
- **Reads/writes**: reads `credit_packages` (service role). Stripe:
  `prices.search` by `metadata['lovable_external_id']`, then
  `checkout.sessions.create` (embedded). No DB writes.
- **Outputs**: `{ client_secret, session_id }`. Error: `{ error: <msg> }`.
  **Leaks `err.message`** (`:122-125`) into the 500 body — SEC-API-PROXY-SCHEMA-1
  family.
- **Failure handling**: no writes, so no partial-write hazard. Crediting is
  deferred to `payments-webhook` (`kind: "credit_purchase"`).

### `create-enterprise-checkout`
[index.ts](../../../supabase/functions/create-enterprise-checkout/index.ts)

- **Trigger**: client `functions.invoke` (enterprise wallet/plan UI). No direct
  invoke string located in active `app/` code — likely the enterprise wallet
  surface; treat as low-traffic. verify_jwt = ON.
- **Auth**: Bearer + `getUser()` (`:51-67`), then **role + org gate** — must
  hold `enterprise_admin` in `user_role_names` AND have
  `profiles.organization_id` (`:72-93`). 403 otherwise.
- **Inputs**: `{ tier: "starter"|"pro"|"business" }` (enterprise tier blocked —
  sales-led). Prices hardcoded (`:30-34`).
- **Reads/writes**: reads `user_role_names`, `profiles`. Stripe
  `paymentIntents.create` (EUR, card only) with metadata
  `relay_kind=enterprise_plan, relay_org_id, relay_tier, relay_actor_id`.
  Uses its **own** Stripe client pinned to `2024-06-20` (not `_shared`).
- **Outputs**: `{ client_secret, payment_intent_id, amount_cents, plan_name,
  tier }`. Error: `{ error: <msg>, stripe: { type, code, status } }` —
  **leaks `err.message`** (`:156`).
- **Failure handling**: no DB write here; org `plan_tier` flip is deferred to
  `payments-webhook` on `payment_intent.succeeded`.

### `create-guest-checkout`
[index.ts](../../../supabase/functions/create-guest-checkout/index.ts)

- **Trigger**: anonymous guest "extend session" paywall. **verify_jwt = false**
  (config.toml) — intentionally public (guest has no account). No active
  invoke caller located (guest-extension paywall path).
- **Auth**: **none** — by design. Validates email regex + `amount_cents >= 50`
  (`:36-47`). No rate limiting.
- **Inputs**: `{ guest_call_id, guest_name?, email, minutes=30,
  amount_cents=1500, return_url, env? }`.
- **Reads/writes**: no DB. Stripe `checkout.sessions.create` (embedded, USD)
  with metadata `kind=guest_extension, guest_call_id, minutes, guest_email`.
- **Outputs**: `{ client_secret, session_id }`. Error **leaks `err.message`**
  (`:95-98`).
- **Failure handling**: crediting deferred to `payments-webhook`
  (`kind=guest_extension` → bumps `guest_calls.free_minutes`). Caller-supplied
  `amount_cents`/`minutes` are **trusted** — a crafted request could create a
  $0.50 checkout for 9999 minutes (amount/minutes not cross-checked against any
  price table). Flag: client-controlled pricing.

### `create-relay-checkout`
[index.ts](../../../supabase/functions/create-relay-checkout/index.ts)

- **Trigger**: client `functions.invoke("create-relay-checkout")` —
  [PaywallModal.tsx:101](../../../app/_components/PaywallModal.tsx). verify_jwt = ON.
- **Auth**: Bearer + `getUser()` (`:56-72`). Any authenticated user.
- **Inputs**: `{ plan: "base"|"pro"|"max" }`. Prices/minutes hardcoded
  server-side (`:32-39`) — **not** client-controlled (contrast guest checkout).
- **Reads/writes**: no DB. Stripe `paymentIntents.create` (EUR, card only),
  metadata `relay_user_id, relay_plan, relay_minutes, relay_plan_name`. Own
  Stripe client `2024-06-20`.
- **Outputs**: `{ client_secret, payment_intent_id, amount_cents, plan_name,
  minutes }`. Error: `{ error: <msg>, stripe: {...} }` — **leaks `err.message`**
  (`:141`).
- **Failure handling**: wallet credit happens later via `credit-relay-payment`
  (client-driven, server-verified) AND/OR `relay-stripe-webhook` /
  `payments-webhook` — all three dedupe on
  `credit_transactions.stripe_session_id`.

### `credit-relay-payment`
[index.ts](../../../supabase/functions/credit-relay-payment/index.ts)

- **Trigger**: client `functions.invoke("credit-relay-payment")` right after
  `confirmPayment()` —
  [PaywallModal.tsx:694](../../../app/_components/PaywallModal.tsx). verify_jwt = ON.
- **Auth**: Bearer + `getUser()` (`:51-67`). Then **server-side verifies the PI
  with Stripe** (`paymentIntents.retrieve`, must be `succeeded`, `:91-102`) and
  checks `intent.metadata.relay_user_id === user.id` (`:117-125`) — client
  cannot credit an arbitrary `pi_…`.
- **Inputs**: `{ payment_intent_id: string }` (must start `pi_`).
- **Reads/writes** (service role): dedupe on
  `credit_transactions.stripe_session_id`; upsert `credit_wallets`
  (balance + lifetime_purchased), insert `credit_transactions`, upsert/update
  `customer_entitlements` (paid_minutes_remaining/lifetime/total_paid_cents).
- **Outputs**: `{ ok, credited, balance }` or `{ ok, dedup, balance }`. Error
  **leaks `err.message`** (`:226-228`).
- **Failure handling**: **idempotent** — dedupes on stripe_session_id; races
  with the webhook are safe (first writes the ledger row, second finds it).
  Partial-write hazard: wallet update + ledger insert + entitlements are NOT in
  one transaction; a crash between them could double-credit on retry (the
  dedupe row is inserted AFTER the wallet update — `:159-181`). Minor.

### `payments-webhook`  ⚠ webhook
[index.ts](../../../supabase/functions/payments-webhook/index.ts)

- **Trigger**: **Stripe webhook**. **verify_jwt = false** (required — Stripe
  sends no Supabase JWT). URL must carry `?env=sandbox|live` (`:196-206`).
- **Auth / signature**: `verifyWebhook()` from `_shared` (HMAC-SHA256, 300s
  window) — **verified, sound** (`:209`). Throws → 400 on bad sig.
- **Inputs**: Stripe `checkout.session.completed` / `transaction.completed`.
  Routes on `metadata`: `relay_user_id` (support plan), `kind=guest_extension`,
  `kind=credit_purchase`.
- **Reads/writes** (service role): support-plan branch upserts `credit_wallets`,
  inserts `credit_transactions`, updates `customer_entitlements`, and may call
  RPC `extend_session_paid_admin` to auto-resume an `expired_free` guest_call.
  guest_extension branch updates `guest_calls.free_minutes/paid_extension_at`.
  credit_purchase branch calls RPC `credit_credits`.
- **Outputs**: `{ received: true }`. Errors return generic `"Webhook error"`
  (no leak) (`:222-224`). **Best webhook error hygiene of the set.**
- **Failure handling**: **idempotent** on `credit_transactions.stripe_session_id`
  (`:37-45`). Event-level dedup: relies on the stripe_session_id ledger row, not
  a generic event-id table, so only the credit branch is truly idempotent; the
  guest_extension branch (`:135-167`) has **no dedup** — a Stripe redelivery of
  the same `guest_extension` session would bump `free_minutes` twice. Flag.

### `relay-stripe-webhook`  ⚠ webhook
[index.ts](../../../supabase/functions/relay-stripe-webhook/index.ts)

- **Trigger**: **Stripe webhook** (PaymentIntent path for support packs).
  **verify_jwt = false**.
- **Auth / signature**: own inline `verifyAndParse()` (`:28-68`) — HMAC-SHA256,
  300s window, requires `STRIPE_WEBHOOK_SECRET` (no fail-open). **Sound.**
- **Inputs**: `payment_intent.succeeded` (and legacy
  `checkout.session.completed`). Metadata `relay_user_id, relay_plan,
  relay_minutes`.
- **Reads/writes** (service role): dedupe on
  `credit_transactions.stripe_session_id` (= PI id), upsert `credit_wallets`,
  insert `credit_transactions`, update `customer_entitlements`.
- **Outputs**: `{ received, credited }` / `{ received, dedup }`. Error:
  `{ error: <msg> }`, status 400 — **leaks `err.message`** (`:191-196`).
- **Failure handling**: **idempotent** on stripe_session_id (`:119-128`).
  Same non-transactional wallet+ledger+entitlements sequence as
  `credit-relay-payment` (low risk given the dedupe gate).

---

# Zoom lifecycle (×10)

All Zoom REST functions use **Server-to-Server OAuth** (`ZOOM_ACCOUNT_ID` +
`ZOOM_CLIENT_ID` + `ZOOM_CLIENT_SECRET`, `account_credentials` grant) to mint a
short-lived bearer; the SDK-token functions use separate SDK key/secret pairs.

### `create-zoom-meeting`
[index.ts](../../../supabase/functions/create-zoom-meeting/index.ts)

- **Trigger**: client `functions.invoke` (staff scheduling a Zoom in a request
  thread). verify_jwt = ON.
- **Auth**: Bearer + `getUser()`, then **role gate** — caller must be
  `engineer` or `supervisor` via `user_role_names` (`:94-108`).
- **Inputs**: `{ request_id, topic, start_at (ISO), duration_minutes=30 }`.
- **Reads/writes**: reads `requests`; Zoom `POST /users/me/meetings` (type 2
  scheduled, `auto_recording:none`, AI Companion on); inserts
  `request_messages` (`message_type=zoom_meeting`) with join URL + zoom id.
- **Outputs**: `{ success, message }`. Error `{ success:false, error:<msg> }`
  — **leaks `err.message`** including raw Zoom API JSON (`:157-159, 190-197`).
- **Failure handling**: no idempotency — repeated calls create multiple Zoom
  meetings + chat cards.

### `end-zoom-meeting`  (Meeting SDK)
[index.ts](../../../supabase/functions/end-zoom-meeting/index.ts)

- **Trigger**: client `functions.invoke("end-zoom-meeting")` —
  [useEngineerSession.ts:274](../../../lib/relay/useEngineerSession.ts),
  [useCustomerSession.ts:500](../../../lib/relay/useCustomerSession.ts),
  [RoomClient.tsx:290](../../../app/room/RoomClient.tsx),
  [EngineerSessionClient.tsx:2153](../../../app/staff/session/[id]/EngineerSessionClient.tsx).
  **verify_jwt = false** in config.toml — but the function still requires a
  Bearer + `getUser()` internally (`:53-69`), so unauth is rejected.
- **Auth**: Bearer + `getUser()`; participant gate — `claimed_by` (engineer) OR
  `customer_user_id` (`:97-108`).
- **Inputs**: `{ session_id }`.
- **Reads/writes**: reads `guest_calls`; Zoom `PUT /meetings/{id}/status`
  `{action:end}` (treats Zoom code 3027 as success); inserts deduped
  `guest_messages` "📞 Zoom meeting ended".
- **Outputs**: `{ ok }` / `{ ok, noop }`. Error `{ error: <msg> }` (`:189-193`)
  — leaks; 502 path also returns raw Zoom `detail` (`:139`).
- **Failure handling**: system-message insert deduped vs latest started/ended
  (`:154-176`). End call is idempotent (no meeting → noop success).

### `mint-zoom-for-session`
[index.ts](../../../supabase/functions/mint-zoom-for-session/index.ts)

- **Trigger**: client `functions.invoke("mint-zoom-for-session")` —
  [EngineerSessionClient.tsx:320,1695,1735](../../../app/staff/session/[id]/EngineerSessionClient.tsx).
  verify_jwt = ON.
- **Auth**: Bearer + `getUser()`; caller must be `claimed_by` engineer OR
  `customer_user_id`, and an engineer must be claimed (`:272-277`).
- **Inputs**: `{ session_id }`.
- **Reads/writes**: reads `guest_calls`, `engineer_profiles` (alias),
  `guest_messages` (staleness check). Zoom: per-participant **registration**
  flow (scheduled meeting + 3 registrants: engineer alias, customer name,
  "Relay Supervisor" observer) with instant-meeting fallback; ends stale live
  meetings first (protects in-progress Relay sessions). Updates
  `guest_calls.zoom_*` + inserts "Zoom meeting started" message.
- **Outputs**: `{ ok, zoom_meeting_id, zoom_join_url, zoom_start_url,
  zoom_observer_url, existing?, restarted?, named? }`. Error `{ error: <msg> }`
  — leaks; 502 returns raw Zoom `detail` (`:379`).
- **Failure handling**: **idempotent** — reuses existing meeting unless the
  latest lifecycle message is "ended" (stale → mint fresh). Retry/backoff on
  Zoom code 3000 ("host in another meeting").

### `restart-guest-zoom`  ⚠ verify_jwt off + no internal auth
[index.ts](../../../supabase/functions/restart-guest-zoom/index.ts)

- **Trigger**: client (the guest restart path). **verify_jwt = false**.
- **Auth**: **NONE** — no Bearer check, no participant check. Anyone who knows a
  `guest_call_id` (a UUID) can end+delete the current Zoom meeting and mint a
  new one for that session. Flag: **unauthenticated state-changing Zoom op**.
- **Inputs**: `{ guest_call_id }`.
- **Reads/writes** (service role): reads `guest_calls`; Zoom end+delete old
  meeting, `POST /users/me/meetings` (instant); updates `guest_calls.zoom_*`;
  inserts a "New video room created" `guest_messages`.
- **Outputs**: `{ ok, reused, zoom_* }`. Error `{ error: <msg> }` — leaks
  (`:171-175`).
- **Failure handling**: 30s dedupe window on `guest_calls.updated_at`
  (`:85-104`) — reuses a just-minted meeting instead of double-minting.

### `start-guest-call`  ⚠ verify_jwt off + anonymous
[index.ts](../../../supabase/functions/start-guest-call/index.ts)

- **Trigger**: anonymous landing-page "start a session" (guest types a name).
  **verify_jwt = false** — by design (no account). Referenced from the legacy
  `widget/customer` surface.
- **Auth**: **none** — anonymous endpoint. Only input cap is name/email length
  slicing. No rate limiting → spam vector (creates Zoom meetings + DB rows +
  notifications per call). Flag.
- **Inputs**: `{ guest_name (req), guest_email?, guest_local_id? }`.
- **Reads/writes** (service role): RPC `find_or_create_guest_thread`; sums prior
  `guest_calls` free-minute usage; Zoom instant-meeting create (ends ALL live
  meetings first — see note); inserts `guest_calls` (status=waiting), seeds a
  welcome `guest_messages`, and fans out `create_notification` RPC to **every**
  engineer.
- **Outputs**: `{ id, thread_id }`. Error `{ error: <msg> }` — leaks (`:237-242`).
- **Failure handling**: Zoom is best-effort (session created without Zoom on
  failure). `endAllLiveMeetings()` (`:34-62`) is a **multi-tenant hazard**: it
  ends EVERY live meeting on the host account unconditionally — a new guest can
  kill another in-progress guest's call. (`mint-`/`restart-` protect active
  sessions; this one does not.) Flag.

### `zoom-sdk-signature`  (Meeting SDK JWT)
[index.ts](../../../supabase/functions/zoom-sdk-signature/index.ts)

- **Trigger**: client `functions.invoke("zoom-sdk-signature")` —
  [ZoomCall.tsx:193](../../../app/_components/ZoomCall.tsx),
  [ZoomEmbed.tsx:642](../../../app/_components/ZoomEmbed.tsx).
  **verify_jwt = false**.
- **Auth**: **NONE** — no Bearer/getUser, no session-membership check. Signs a
  Meeting SDK JWT for ANY `meetingNumber` supplied, and for `role=1` (host) it
  fetches a **zak host token** (`guest_calls.zoom_start_url` → Zoom API). Flag:
  **unauthenticated SDK-host-token minting** — caller-controlled
  `meetingNumber` + `role:1` yields host credentials for any meeting id the
  function can resolve. (Legacy Meeting SDK path; Video SDK is now default per
  recent commits.)
- **Inputs**: `{ meetingNumber, role }`.
- **Reads/writes**: reads `guest_calls.zoom_start_url` (service role); Zoom
  GET-meeting (passcode/host_id), optional `/users/{id}/token?type=zak`.
- **Outputs**: `{ signature, sdkKey, password, zak }`. Error `{ error:<msg> }`.
- **Failure handling**: n/a (read/sign only).

### `zoom-video-sdk-token`  (Video SDK JWT)
[index.ts](../../../supabase/functions/zoom-video-sdk-token/index.ts)

- **Trigger**: client `functions.invoke("zoom-video-sdk-token")` —
  [useZoomCall.ts:211](../../../lib/video/useZoomCall.ts). verify_jwt = ON.
- **Auth**: Bearer + `getUser()`; rich membership gate — `claimed_by`
  engineer, `customer_user_id`, `supervisor_user_id`, OR an acked/joined
  `session_escalations` supervisor (`:93-133`). 403 otherwise. **Strongest auth
  in the Zoom group.**
- **Inputs**: `{ session_id }`.
- **Reads/writes**: reads `guest_calls`, `session_escalations`; idempotently
  stamps `guest_calls.video_topic`; posts deduped "Zoom meeting started"
  message; inserts `session_video_events` (token_issued audit).
- **Outputs**: `{ token, topic, session_key, user_identity, role_type,
  sdk_key }`. Error: `{ error: String(e) }` — **leaks raw error** (`:225-228`).
- **Failure handling**: topic stamp + message insert both deduped/idempotent.
  `role_type` host(1) only for engineer or appointment-supervisor.

### `zoom-video-sdk-end`  (Video SDK)
[index.ts](../../../supabase/functions/zoom-video-sdk-end/index.ts)

- **Trigger**: client `functions.invoke("zoom-video-sdk-end")` —
  [useZoomCall.ts:1051](../../../lib/video/useZoomCall.ts) (also a raw fetch at
  `:557`). verify_jwt = ON (not in config.toml list).
- **Auth**: Bearer + `getUser()`; engineer (`claimed_by`), customer, or
  supervisor-class role (`:76-100`). `endForAll` only for engineer/supervisor.
- **Inputs**: `{ session_id }`.
- **Reads/writes**: stamps `guest_calls.video_ended_at` (idempotent), clears
  the leaving party's `*_joined_at`, posts deduped "Zoom meeting ended"
  message, inserts `session_video_events`, fires `summarize-call`
  (fire-and-forget, service-role bearer).
- **Outputs**: `{ ok, end_for_all }`. Error `{ error: String(e) }` — **leaks**
  (`:199-203`).
- **Failure handling**: idempotent stamps + deduped message. Summarize is
  best-effort.

### `zoom-webhook`  ⚠ webhook, fail-open
[index.ts](../../../supabase/functions/zoom-webhook/index.ts)

- **Trigger**: **Zoom Marketplace webhook** (Meeting SDK events). **verify_jwt =
  false**.
- **Auth / signature**: `verifyZoomSignature()` (`:36-47`) — HMAC `v0:ts:body`
  vs `x-zm-signature`. **FAIL-OPEN**: `if (!ZOOM_WEBHOOK_SECRET_TOKEN) return
  true` (`:40`) — if the secret env is unset, **all signatures pass**. Also
  handles the `endpoint.url_validation` CRC challenge. Flag.
- **Inputs**: `meeting.started`, `meeting.ended`, `recording.completed`,
  `meeting.summary_completed` / `meeting_summary.completed`.
- **Reads/writes** (service role): matches `request_messages.meeting_zoom_id` /
  `guest_calls.zoom_meeting_id`; upserts `call_sessions`; **bills** via RPC
  `debit_credits` (16.667 credits/min) on `meeting.ended` (logged-in path);
  writes `call_recordings`; posts chat summaries; chains
  `regenerate-guest-brief` + `summarize-guest-call` on summary events.
- **Outputs**: `{ ok }`. Errors return generic `"Error"`/`"Invalid signature"`
  (no leak). Good.
- **Failure handling**: billing guarded by `status==='billed'` check
  (`:170-173, 226-229`) — **idempotent bill**. Guest "ended" message deduped
  (`:140-156`). Summary insert deduped by body equality (`:448-462`). The
  best-structured webhook of the three.

### `zoom-video-webhook`  ⚠ webhook, fail-open + double-bill
[index.ts](../../../supabase/functions/zoom-video-webhook/index.ts)

- **Trigger**: **Zoom Video SDK webhook**. verify_jwt = ON (not in config.toml
  list — but Zoom sends no JWT, so if deployed without `--no-verify-jwt` the
  platform would 401 every delivery; assume deployed `--no-verify-jwt`). Keys
  off `session_key` (= `guest_calls.id`) or `relay-session-<id>` topic.
- **Auth / signature**: `verifyZoomSignature()` (`:53-63`) — same **FAIL-OPEN**
  bug: `if (!ZOOM_VIDEO_WEBHOOK_SECRET) return true` (`:57`). Flag.
- **Inputs**: `session.started`, `session.ended`, `recording.completed`.
- **Reads/writes** (service role): stamps `guest_calls.video_started_at/
  video_ended_at`; upserts `call_sessions` (keyed `session_key`); **bills** via
  `debit_credits`; writes `guest_calls.recording_*`; inserts
  `session_video_events`; posts chat messages; chains `summarize-guest-call`.
- **Outputs**: `{ ok }` / generic `"Error"` (no leak).
- **Failure handling**: ⚠ **`session.ended` has NO `status==='billed'` guard**
  before `debit_credits` (`:149-218`) — a Zoom redelivery of `session.ended`
  re-stamps (idempotent) but **re-bills `debit_credits`** and re-inserts the
  "ended" chat message (no dedupe). **Non-idempotent webhook write — double-bill
  hazard.** Contrast `zoom-webhook`, which guards on `billed`. Flag loudly.

---

# AI (×9) — OpenAI / Groq, NOT Anthropic

### `score-session-health`  ⚠ verify_jwt off, cron-triggered
[index.ts](../../../supabase/functions/score-session-health/index.ts)

- **Trigger**: **pg_cron every minute** via `net.http_post` with service-role
  bearer ([scripts/schedule-health-cron.sql:16](../../../scripts/schedule-health-cron.sql)).
  **verify_jwt = false** → also openly POST-able by anyone (no internal auth
  gate beyond `OPENAI_API_KEY` presence). Each open call scans active sessions
  and burns OpenAI tokens. Flag: **unauthenticated cost vector**.
- **Auth**: none internal.
- **Inputs**: `{}` (body ignored).
- **Reads/writes** (service role): reads `guest_calls` (active statuses),
  `guest_messages`, `session_captions`; per active session one OpenAI
  `chat/completions` call — model `OPENAI_SENTIMENT_MODEL ?? "gpt-4o-mini"`,
  temp 0, JSON mode; inserts `sup_sentiment` (phase=live) + legacy
  `session_health`.
- **Outputs**: `{ sessions, scored, skipped, errors }`. The `errors[]` array
  includes upstream OpenAI status + truncated body (`:257-259`) — minor leak of
  upstream text into the response.
- **Failure handling**: `Promise.allSettled` per session (one failure ≠ whole
  tick). Not idempotent by design — each tick appends rows; readers take latest.
  No-signal sessions skipped pre-model (cost guard).

### `summarize-call`
[index.ts](../../../supabase/functions/summarize-call/index.ts)

- **Trigger**: edge-fn → edge-fn — `zoom-video-sdk-end` fires it via raw fetch
  with service-role bearer (`:183`). verify_jwt = ON (service bearer satisfies
  it). Accepts `guest_call_id` OR `session_id`.
- **Auth**: relies on verify_jwt (service-role token) — no internal user check.
- **Inputs**: `{ guest_call_id | session_id }`.
- **Reads/writes** (service role): reads `guest_calls`, `session_captions`,
  `guest_messages`; OpenAI `gpt-4o-mini` JSON; inserts ONE "🤖 AI Companion
  summary" `guest_messages`; fires RAG `index-session` (if `APP_URL` +
  `RAG_INDEX_SECRET`).
- **Outputs**: `{ ok, title }` / `{ skipped: ... }`. Error
  `{ error, detail: String(e) }` — **leaks** (`:240-242`); OpenAI failure path
  returns upstream `detail` (`:176-178`).
- **Failure handling**: **idempotent** — skips if an AI-Companion-shaped system
  message already exists (`:51-62`).

### `summarize-customer`
[index.ts](../../../supabase/functions/summarize-customer/index.ts)

- **Trigger**: edge-fn cascade from `summarize-project` (service bearer) +
  `summarize-guest-call` (`functions.invoke`). **verify_jwt = false**
  (config.toml) → also openly callable with `{ customer_id }`. No internal auth
  → anyone can trigger an OpenAI roll-up + overwrite `customer_summaries`. Flag.
- **Inputs**: `{ customer_id }`.
- **Reads/writes** (service role): reads `projects`; OpenAI `gpt-4o-mini` JSON;
  upserts `customer_summaries`.
- **Outputs**: `{ ok, summarized_projects }`. Error `{ error: String(e) }` —
  **leaks** (`:181-185`). OpenAI failure text written into the stored `summary`.
- **Failure handling**: upsert (idempotent overwrite). No dedup needed.

### `summarize-guest-call`  (the orchestrator, 709 lines)
[index.ts](../../../supabase/functions/summarize-guest-call/index.ts)

- **Trigger**: client `functions.invoke("summarize-guest-call")` —
  [useEngineerSession.ts:277](../../../lib/relay/useEngineerSession.ts),
  [useCustomerSession.ts:503](../../../lib/relay/useCustomerSession.ts),
  [RoomClient.tsx:287](../../../app/room/RoomClient.tsx); AND edge-fn re-runs
  from `zoom-webhook` (`:494`) + `zoom-video-webhook` (`:242`). **verify_jwt =
  false**. No internal auth gate → openly callable with `{ guest_call_id }`,
  forcing a session to "ended" + AI spend. Flag.
- **Inputs**: `{ guest_call_id }`.
- **Reads/writes** (service role): reads `guest_calls`, `guest_threads`,
  `guest_messages`, `session_captions`; two OpenAI `gpt-4o-mini` calls (summary
  + sentiment); writes `guest_calls` (status→ended, ai_summary_*, summary_state,
  duration, final_sentiment_*), `guest_threads.free_minutes_used`,
  `session_health`, `sup_sentiment`, `guest_messages` (Session-ended chip +
  capsule); cascades `regenerate-guest-brief`, `summarize-project` OR
  `summarize-customer`; fires RAG index. Drives a `summary_state` machine
  (generating → ready/failed/waiting_for_transcript/...) read by a watchdog
  pg_cron.
- **Outputs**: `{ summary }` / `{ summary:null, summary_state }`. Error
  `{ error: String(e) }` — **leaks** (`:704-707`).
- **Failure handling**: `wasAlreadyEnded` guard makes one-shot side effects
  (status flip, duration, chips, free-minute increment) **idempotent** across
  re-runs; summary fields always refreshed. Capsule + sentiment deduped/upserted.
  Crash mid-flight leaves `summary_failed` state for the watchdog. Robust.

### `summarize-intake`
[index.ts](../../../supabase/functions/summarize-intake/index.ts)

- **Trigger**: client `functions.invoke("summarize-intake")` —
  [MatchingClient.tsx:324](../../../app/intake/matching/[id]/MatchingClient.tsx).
  verify_jwt = ON.
- **Inputs**: `{ intake_id }`.
- **Reads/writes** (service role): reads `client_intakes`; OpenAI `gpt-4o-mini`
  JSON; writes `client_intakes.intake_summary` + matcher signals
  (`issues[]`, `environments[]`, `urgency`) consumed by the match RPC.
- **Outputs**: `{ ok, user_turns, attachments, issues_extracted, ... }`. Error
  `{ error: String(e) }` — **leaks** (`:257-261`).
- **Failure handling**: writes a stub from wizard answers when no user turns.
  Tolerant of malformed LLM JSON (keeps prior issues/environments). Overwrite =
  effectively idempotent.

### `summarize-project`
[index.ts](../../../supabase/functions/summarize-project/index.ts)

- **Trigger**: edge-fn cascade from `summarize-guest-call` (`functions.invoke`).
  **verify_jwt = false** → openly callable with `{ project_id }`. No internal
  auth. Flag (cost + overwrite `projects.ai_summary_*`).
- **Inputs**: `{ project_id }`.
- **Reads/writes** (service role): reads `projects`, `guest_calls` (ended);
  OpenAI `gpt-4o-mini` JSON; updates `projects.ai_summary_*`; cascades to
  `summarize-customer` (service bearer); fires RAG index.
- **Outputs**: `{ ok, summarized_sessions }`. Error `{ error: String(e) }` —
  **leaks** (`:235-239`).
- **Failure handling**: overwrite (idempotent). Clears roll-up when no sessions.

### `regenerate-guest-brief`  ⚠ verify_jwt off, Groq
[index.ts](../../../supabase/functions/regenerate-guest-brief/index.ts)

- **Trigger**: edge-fn from `zoom-webhook` (`:472`, service bearer) +
  `summarize-guest-call` (`:613`, invoke). **verify_jwt = false** → openly
  callable with `{ thread_id }`. No internal auth. Flag.
- **Auth**: none internal.
- **Inputs**: `{ thread_id }`.
- **Reads/writes** (service role): reads `guest_threads`, `guest_calls`;
  **Groq** `chat/completions` model `llama-3.3-70b-versatile` (key
  `GROQ_API_KEY ?? LOVABLE_API_KEY`; header comment "Lovable AI Gateway" is
  stale — endpoint is `api.groq.com`); updates `guest_threads.rolling_brief`.
- **Outputs**: `{ brief }`. Error `{ error: String(e) }` — **leaks** (`:118-122`).
- **Failure handling**: only writes when the model returns text; otherwise
  leaves prior brief. Overwrite = idempotent.

### `morning-brief`  ⚠ no internal auth, marked "NOT WIRED"
[index.ts](../../../supabase/functions/morning-brief/index.ts)

- **Trigger**: intended pg_cron daily 08:00 (deploy doc says
  `--no-verify-jwt`). NOT in config.toml → committed config = verify_jwt ON;
  header says deploy with `--no-verify-jwt`. **No internal auth gate at all** —
  if deployed `--no-verify-jwt`, anyone can trigger email sends + a full
  `auth.admin.listUsers` enumeration (1000 users). Flag.
- **Inputs**: none.
- **Reads/writes** (service role): reads `pods`, `pod_members`,
  `auth.admin.listUsers`, `session_escalations`, `guest_calls`,
  `engineer_availability_windows`, `engineer_holidays`; **sends email via
  SendGrid** `/v3/mail/send` (no-op log if `SENDGRID_API_KEY` unset).
- **Outputs**: `{ ok, briefsSent }`. No try/catch wrapper → an unhandled throw
  surfaces a raw 500 from the runtime.
- **Failure handling**: not idempotent — re-invoking re-sends all emails (no
  per-day dedup). Best-effort per-recipient.

### `transcribe-chunk`
[index.ts](../../../supabase/functions/transcribe-chunk/index.ts)

- **Trigger**: client `functions.invoke("transcribe-chunk")` —
  [useZoomCall.ts:725](../../../lib/video/useZoomCall.ts) (each participant's
  ~30s mic slice). verify_jwt = ON.
- **Inputs**: `multipart/form-data` — `file` (audio), `session_id`, `speaker?`,
  `started_at?`.
- **Reads/writes** (service role): validates `guest_calls.id` exists; OpenAI
  **Whisper** `whisper-1` transcription; inserts `session_captions`. Drops
  known silence-hallucination strings + slices <2KB (cost guard).
- **Outputs**: `{ ok, chars }` / `{ skipped }`. Error
  `{ error, detail: String(e) }` — **leaks** (`:139-141`); Whisper failure
  returns upstream `detail` (`:109-112`).
- **Failure handling**: append-only (each slice = one row); no idempotency
  needed. Junk session id rejected (404).

---

# Housekeeping (×1)

### `purge-completed-projects`  (best-auth model)
[index.ts](../../../supabase/functions/purge-completed-projects/index.ts)

- **Trigger**: scheduler (pg_cron / external) daily 03:00 UTC. verify_jwt = ON.
- **Auth**: **shared-secret** `x-cron-secret` header must equal
  `PURGE_CRON_SECRET`, and rejects when the env is unset (no fail-open)
  (`:65-71`). **Correct pattern** — the only function with explicit anti-
  fail-open secret handling at the handler level.
- **Inputs**: none (header only).
- **Reads/writes** (service role): RPC `list_projects_ready_for_purge`; walks
  `guest_message_attachments → guest_messages → guest_calls.project_id`;
  **deletes Storage objects** (`STORAGE_BUCKET`, default `chat-attachments`, in
  chunks of 100); RPC `archive_project` (SECURITY DEFINER, marks purged + flips
  project to archived atomically).
- **Outputs**: `{ purged, projects[] }`; per-project `storageErr` surfaced
  (RPC/Storage `.message` leaked into the response — minor).
- **Failure handling**: **idempotent** — re-run finds nothing (purged=false
  filter + archived flip). Storage delete failures are logged, don't abort the
  sweep, and are reported per project.

---

# Findings

## Unauthenticated / weak-auth functions (no internal caller verification)
Beyond the legitimately-public guest/Stripe/Zoom-webhook endpoints, these are
`verify_jwt = false` **and** have **no internal auth gate**, so any
internet caller who can guess a UUID/id triggers state changes or AI/email
spend:

1. **`restart-guest-zoom`** — no auth; ends+deletes the live Zoom meeting and
   mints a new one for any `guest_call_id`. State-changing.
2. **`zoom-sdk-signature`** — no auth; mints a Meeting SDK JWT and a **host zak
   token** for any caller-supplied `meetingNumber` + `role:1`. Credential
   minting. (Legacy Meeting-SDK path.)
3. **`summarize-guest-call`** — no auth; forces a session to `ended` + double
   OpenAI spend for any `guest_call_id`.
4. **`summarize-project`**, **`summarize-customer`**, **`regenerate-guest-brief`**
   — no auth; OpenAI/Groq spend + overwrite of stored summaries for any id.
5. **`score-session-health`** — no auth; per-call fan-out OpenAI spend across
   all active sessions.
6. **`morning-brief`** — no internal auth; if deployed `--no-verify-jwt` (as its
   own header instructs), open trigger of SendGrid sends + a 1000-row
   `auth.admin.listUsers` enumeration.
7. **`start-guest-call`** — anonymous by design, but **unbounded** (no rate
   limit) and its `endAllLiveMeetings()` kills EVERY live Zoom on the host
   account (cross-session denial-of-service).

> Functions that are `verify_jwt = false` but DO verify a Bearer/getUser
> internally are fine: `end-zoom-meeting`. Service-bearer-only cascades
> (`summarize-call`) rely on verify_jwt=ON.

## Unsigned / fail-open webhooks
- **`zoom-webhook`** — `verifyZoomSignature` returns `true` when
  `ZOOM_WEBHOOK_SECRET_TOKEN` is unset (`:40`). **Fail-open.**
- **`zoom-video-webhook`** — same fail-open on `ZOOM_VIDEO_WEBHOOK_SECRET`
  (`:57`).
- Stripe webhooks (`payments-webhook`, `relay-stripe-webhook`) and `_shared`
  **do NOT** fail open — they throw if the secret is missing. Good.

## Error-text leaks (SEC-API-PROXY-SCHEMA-1 family)
Return `err.message` / `String(e)` (and sometimes raw upstream Stripe/Zoom/
OpenAI bodies) in the HTTP response: `create-credits-checkout`,
`create-enterprise-checkout`, `create-guest-checkout`, `create-relay-checkout`,
`credit-relay-payment`, `relay-stripe-webhook`, `create-zoom-meeting`,
`end-zoom-meeting`, `mint-zoom-for-session`, `restart-guest-zoom`,
`start-guest-call`, `zoom-video-sdk-token`, `zoom-video-sdk-end`,
`summarize-call`, `summarize-customer`, `summarize-guest-call`,
`summarize-intake`, `summarize-project`, `regenerate-guest-brief`,
`transcribe-chunk` (and `score-session-health` / `purge-completed-projects`
leak upstream/RPC `.message` more narrowly).
Clean (generic error text only): `payments-webhook`, `zoom-webhook`,
`zoom-video-webhook`.

## Non-idempotent / double-write webhook hazards
- **`zoom-video-webhook` `session.ended`** — ⚠ **no `status==='billed'` guard
  before `debit_credits`**; a Zoom redelivery **double-bills** and re-posts the
  "ended" chat message. (Sibling `zoom-webhook` guards correctly.)
- **`payments-webhook` guest_extension branch** — bumps
  `guest_calls.free_minutes` with **no dedup**; a Stripe redelivery extends the
  session twice. (The relay-plan + credit_purchase branches DO dedupe on
  `credit_transactions.stripe_session_id`.)
- **`create-guest-checkout`** — `amount_cents`/`minutes` are client-supplied and
  not validated against any price table (pay $0.50 → claim arbitrary minutes via
  the webhook).
- Minor: `credit-relay-payment` / `relay-stripe-webhook` do wallet + ledger +
  entitlements writes non-transactionally (guarded by the stripe_session_id
  dedupe row, low risk).
</content>
</invoke>
