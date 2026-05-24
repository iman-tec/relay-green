# Relay.green — Launch Runbook

> Pre-launch QA closed 2026-05-24. This doc is the operator playbook for
> launch day, the first week, and incident response. Keep it under 5
> minutes to read; deeper detail belongs in the code or in `docs/`.

---

## 1. Before you press deploy

### 1.1 Environment variables (Vercel → Project → Settings → Environment Variables)

Required in Production:

| Var | Purpose | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public, ships to the client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Public, ships to the client |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role | Server-only — never expose |

Strongly recommended in Production:

| Var | Purpose | If missing |
|---|---|---|
| `RESEND_API_KEY` | Sends contact-form inquiries via Resend | Leads are logged to the server console instead — someone must tail logs |
| `CONTACT_INBOX_EMAIL` | Where `/api/contact` sends inquiries | Defaults to `hello@relay.green` |
| `CONTACT_FROM_EMAIL` | From: address on contact emails | Defaults to `noreply@relay.green` (must be on a verified Resend domain) |

Optional for marketing-only launch (wire up when the app behind sign-in goes live):

`DATABASE_URL`, `STRIPE_*`, `ANTHROPIC_*`, `ZOOM_VIDEO_SDK_*`, `TWILIO_*`.

### 1.2 DNS + mail

- [ ] `relay.green` and `www.relay.green` both pointed at Vercel; apex → www edge redirect on.
- [ ] SSL auto-issued by Vercel (no action needed on a clean Vercel domain).
- [ ] MX records resolve for **every** alias used in the site copy: `support@`, `hello@`, `legal@`, `dpo@`, `sales@relay.green`.
- [ ] If using Resend: domain `relay.green` (or a subdomain) is verified in Resend dashboard with SPF + DKIM + DMARC.

### 1.3 Static files

**Windows installers (currently held back):**
The unsigned `Relay-Setup.exe` and `Relay-Staff-Setup.exe` have been
moved to `/public/_unreleased-downloads/` (not served at any URL). The
`/download` page shows a "coming soon — in code-signing" panel in place
of the Windows BuildCard. To restore once signed:

1. Code-sign with Authenticode (OV or EV cert; EV avoids SmartScreen
   warnings entirely). Recommended cert providers: SSL.com OV (~$199/yr),
   Sectigo EV (~$300+/yr).
2. Move both `.exe` files back to `/public/downloads/`.
3. In `app/download/page.tsx`: restore the `CUSTOMER_BUILD` /
   `STAFF_DOWNLOAD` constants (the originals are documented in the
   block-comment at the top), and swap `<ComingSoonWindowsPanel />`
   back to `<BuildCard build={CUSTOMER_BUILD} />` + the staff footer
   download link.

**Other static checks:**
- [ ] OG cards render correctly: visit `/opengraph-image`, `/twitter-image`, `/pricing/opengraph-image`, `/product/opengraph-image`, `/for-enterprise/opengraph-image` on the preview deploy.

### 1.4 Legal sign-off

Source-code `DRAFT — counsel review pending` markers were removed in
the pre-launch QA pass (alongside their twins in the user-visible meta
descriptions). **The legal text itself has not yet been reviewed by
counsel** — getting that review remains a launch-day prerequisite.

When counsel signs off:

- Update the `Last updated:` line in the hero of each legal page to the
  approval date.
- If counsel's revisions are substantive, log the change in the page's
  block comment (`// Reviewed by <firm>, <date>.`).
- No other source changes are needed — the page text is already what
  ships to visitors.

---

## 2. Deploy

```bash
# From a clean local checkout
git checkout main
git pull
git tag -a v1.0.0-launch -m "Marketing site go-live"
git push origin v1.0.0-launch

# Vercel auto-deploys main; alternatively:
vercel deploy --prod
```

After the deploy completes:

- [ ] Open the production URL.
- [ ] Run the smoke test in §3.
- [ ] If anything is broken, run §5 (rollback) before debugging.

---

## 3. Production smoke test (10 minutes, do not skip)

Run from a fresh browser profile (Cmd-Shift-N / Ctrl-Shift-N — no cached cookies or auth):

### 3.1 Core pages render under 2 seconds on cable

- [ ] `/` — Spline hero loads (or gracefully degrades on reduced-motion).
- [ ] `/product` — H1 + 4-step timeline render.
- [ ] `/for-enterprise` — H1 + C-suite "conversations" card.
- [ ] `/pricing` — Pricing tiers + FAQ render.
- [ ] `/legal/privacy-policy`, `/legal/terms-of-use`, `/legal/cookies` — body text renders.

### 3.2 Navigation

- [ ] Nav links: How it Works / For Enterprises / Pricing / About RELAY all resolve.
- [ ] Mobile hamburger opens the drawer (Chrome DevTools device emulation ≤ 980 px).
- [ ] "Sign in" → `/login` redirects to login form.
- [ ] "Try RELAY" button opens the modal (try the caret menu too — should show "Download Relay Desktop").

### 3.3 Cookie consent + analytics

- [ ] Cookie banner appears on first visit.
- [ ] Click "Cookie settings" → toggles render → "Save settings" dismisses.
- [ ] Reload — banner does NOT reappear.
- [ ] Click footer "Manage cookie preferences" — banner re-opens with the saved choices pre-selected.
- [ ] DevTools → Network → with consent ACCEPTED, see beacons to `va.vercel-scripts.com` and `vitals.vercel-insights.com`. With consent REJECTED, no beacons.

### 3.4 Forms

- [ ] On `/for-enterprise`, click "Talk to Relay for Enterprise" → form opens.
- [ ] Submit with bad email (e.g. "foo") → 400 error message shown.
- [ ] Submit 6 times in a row with valid data from one IP → 6th hits 429 rate limit.
- [ ] After valid submission, lead arrives at `CONTACT_INBOX_EMAIL` (or in the Vercel log if Resend unset).

### 3.5 CSP + security headers

- [ ] DevTools → Network → click `/` → response headers include:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), …`
  - `Content-Security-Policy-Report-Only: default-src 'self'; …`
- [ ] DevTools → Console → no CSP violations during a normal browsing session.
- [ ] Cookie-consent legal-preview iframe opens (`/legal/privacy-policy?embed=1`) — X-Frame-Options must be `SAMEORIGIN` not `DENY` for this to work.

### 3.6 OG card preview

Paste the production URLs into a card preview tool, confirm the cream-green card renders with the right headline:

- [ ] iMessage preview (paste in any chat)
- [ ] Slack channel paste
- [ ] LinkedIn Post Inspector — https://www.linkedin.com/post-inspector/
- [ ] X (Twitter) Card Validator — https://cards-dev.twitter.com/validator

### 3.7 Lighthouse

```bash
# Run from a clean Chrome profile, throttled to 3G
# Target scores:
#   Performance     ≥ 90 (desktop), ≥ 75 (mobile)
#   Accessibility   ≥ 95
#   Best Practices  ≥ 95
#   SEO             ≥ 95
```

---

## 4. Submit to search engines

After §3 passes:

- [ ] **Google Search Console** — verify ownership of `www.relay.green` via DNS TXT or HTML file, then submit `https://www.relay.green/sitemap.xml`.
- [ ] **Bing Webmaster Tools** — same drill, submit the sitemap.
- [ ] **IndexNow** — POST the URLs you want indexed immediately to `https://api.indexnow.org/indexnow`. Picked up by Bing, Yandex, Naver, Seznam.
- [ ] Validate JSON-LD with Google Rich Results Test on `/`, `/pricing`, `/product`, `/for-enterprise`: https://search.google.com/test/rich-results

---

## 5. Rollback

**If anything is wrong, roll back first, debug second.**

```bash
# List recent deploys
vercel ls relay-green

# Roll the production alias back to a known-good deploy
vercel alias set <previous-deploy-url> www.relay.green
vercel alias set <previous-deploy-url> relay.green

# Or from the Vercel dashboard: Deployments → click previous → "Promote to Production"
```

If a bad deploy ships a manifest / OG / robots.txt change you need to flush, run the alias commands above — Vercel's edge purges within ~30 seconds.

For DNS rollbacks: TTL on the Vercel apex / www records is 60s by default, so a misrouting is fixable inside 2 minutes by reverting at your DNS provider.

---

## 6. CSP enforce-mode cutover

CSP currently ships as `Content-Security-Policy-Report-Only` so browsers log violations to the console without blocking content. After a clean soak window:

1. Watch DevTools console + (if wired up) the `report-uri` endpoint for ~1 week.
2. Add any legitimately-needed sources to the allowlist in `next.config.ts`.
3. When violations have been zero for 3+ consecutive days, change the header key from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `next.config.ts`.
4. Deploy. Roll back via §5 if anything breaks (you'll know within 60 seconds — the page goes blank).

---

## 7. Known advisories (acceptable for launch)

`npm audit` shows 5 moderate findings, all in Prisma's transitive `@prisma/dev` package:

| Package | Severity | Why it's not blocking |
|---|---|---|
| `@hono/node-server` < 1.19.13 | moderate | Inside `@prisma/dev`, which is a dev-only CLI dep. Never imported at runtime. |
| `@prisma/dev` | moderate | Bundled with `prisma` v7 but never imported by `lib/db.ts` (which is a Proxy stub — see `CLAUDE.md` "Persistence: Supabase is the database, not Prisma"). |
| `next` (advisory recommends downgrade to v9) | moderate | False positive — `npm audit` suggests a 7-major-version downgrade. Real fix is upstream. |
| `postcss` < 8.5.10 | moderate | Transitive of `next`. CSS-only XSS vector requires attacker-controlled CSS, which the marketing site does not load. |
| `prisma` | moderate | Same root cause as `@prisma/dev`. |

**Re-check this section** after each `next` minor release — most of these clear when the upstream chain bumps `postcss` and `@hono/node-server`.

---

## 8. Who to call

| Domain | Owner |
|---|---|
| Domain + DNS + Vercel project | _fill in before launch_ |
| Supabase project | _fill in_ |
| Resend account + verified domain | _fill in_ |
| Legal counsel (privacy / terms / cookies) | _fill in_ |
| On-call rotation for the first 72 hours | _fill in_ |

---

## 9. Changes that shipped in pre-launch QA (2026-05-24)

Tracked in `elements.txt` and the closing PR description. Quick reference:

- Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP report-only) added in [next.config.ts](next.config.ts).
- `app/robots.ts` extended to disallow all auth surfaces, widget routes, and (deleted) design-comp directories.
- `public/manifest.webmanifest`, `public/aaklmblue/`, `public/espresso/` deleted.
- `app/manifest.ts` + `app/layout.tsx` viewport aligned on brand green `#4d6b40`.
- `app/legal/cookies/page.tsx` vendor table rewritten to match actual implementation (Vercel Analytics + Speed Insights only).
- Footer Contact Us deep-links to `#contact`; new "Manage cookie preferences" link with GDPR-compliant reopen flow.
- BreadcrumbList JSON-LD on `/product` and `/for-enterprise`.
- Per-page OG cards for `/product` and `/for-enterprise`.
- New `POST /api/contact` endpoint with honeypot, per-IP rate limit (5 / 10 min), Resend send, mailto fallback. All four marketing forms now use `lib/contact/submitContact.ts`.
- `elements.txt` written as the marketing-site content inventory.
