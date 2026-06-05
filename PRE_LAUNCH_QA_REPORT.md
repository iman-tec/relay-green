# Relay.green — Pre-Launch QA Report

**Audit date:** 2026-05-27
**Auditor:** Senior pre-launch QA (Claude Code)
**Scope:** Public marketing surface only (homepage, /product, /for-enterprise, /company/about, /trust/_, /legal/_, /login, /download-relay-desktop and shared chrome). Excludes authenticated app (`/room`, `/dashboard`, `/inbox`, `/supervise`, `/staff/*`, `/widget/*`, `/admin`, `/enterprise`, etc.).
**Stack:** Next.js 16 (App Router) + React 19 + Tailwind v4
**Canonical host:** `https://www.relay.green`

> **Authority rules respected.** No brand messaging, design direction, animation style, copy, video, image, link destination, or legal text was changed without approval. Only clear-technical fixes were applied. Items needing approval are listed in §6 and §7.

---

## 1. Executive summary

| Area                   | Status                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing / broken links | ✅ One broken anchor found and fixed; all other internal hrefs resolve                                                                                                                                                                    |
| Assets / 404s          | ✅ All `<img>`-equivalent assets resolve. A handful of unused legacy assets in `public/` flagged for cleanup approval                                                                                                                     |
| SEO infrastructure     | ✅ robots, sitemap, manifest, icon, apple-icon, OG, Twitter card, JSON-LD (Organization, WebSite, WebPage, BreadcrumbList, FAQPage, Article, Service, VideoObject) all in place                                                           |
| Per-page metadata      | ✅ Unique title + description + canonical on every in-scope page; noindex correctly applied to stub legal pages                                                                                                                           |
| Headings               | ✅ Single H1 verified on /, /product, /for-enterprise, /trust at 375 px mobile                                                                                                                                                            |
| Mobile responsiveness  | ✅ No horizontal overflow at 375 px on /, /product, /for-enterprise, /trust. 6,237-line marketing.css with breakpoints at 480 / 600 / 640 / 720 / 768 / 880 / 900 / 980 / 1024 / 1100 / 1180 px                                           |
| Accessibility basics   | ✅ No empty `alt`. No `<img>` in marketing scope (SVG icons + CSS flag backgrounds). Native `<details>` for FAQ, `<dialog>`-equivalent ARIA on modals, escape-key handlers, focus trap, prefers-reduced-motion supported in 17+ keyframes |
| External links         | ✅ Zero `target="_blank"` external links in marketing scope; nothing missing `rel="noopener noreferrer"`                                                                                                                                  |
| Secrets / localhost    | ✅ Zero secrets, zero `localhost`/`127.0.0.1`/`10.0.1.207` references in any marketing page                                                                                                                                               |
| Console logs           | ✅ Zero `console.log/warn/error/debug` in `app/_marketing/**`                                                                                                                                                                             |
| Cookie consent         | ✅ GDPR/DPDP/CCPA-aware banner with Accept / Settings, gates Vercel Analytics + Speed Insights via `AnalyticsGate`, withdraw-of-consent path from Footer                                                                                  |
| Legal pages            | ✅ Privacy Policy, Terms of Use, Cookies, DPA, Acceptable Use, Terms-Consumer, Terms-Commercial, Sub-Processors all present; Trust Center has Privacy, Compliance, Data-Handling, Sub-Processors, Responsible Disclosure, Security        |

**Verdict:** **Ready with minor risks.** See §11 + §13.

---

## 2. Pages tested

The following 14 in-scope routes were inventoried, link-checked, and (where applicable) live-verified at 375 px mobile against the running dev server.

| Route                           | File                                                                                                                           | Live-tested at 375 px |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `/`                             | `app/page.tsx` + `app/_marketing/Home.tsx`                                                                                     | ✅                    |
| `/product`                      | `app/product/page.tsx`                                                                                                         | ✅                    |
| `/for-enterprise`               | `app/for-enterprise/page.tsx`                                                                                                  | ✅                    |
| `/company/about`                | `app/company/about/page.tsx` (Contact)                                                                                         | static review         |
| `/download-relay-desktop`       | `app/download-relay-desktop/page.tsx`                                                                                          | static review         |
| `/login`                        | `app/login/page.tsx`                                                                                                           | ✅                    |
| `/trust`                        | `app/trust/page.tsx`                                                                                                           | ✅                    |
| `/trust/privacy`                | `app/trust/privacy/page.tsx`                                                                                                   | static review         |
| `/trust/compliance`             | `app/trust/compliance/page.tsx`                                                                                                | static review         |
| `/trust/data-handling`          | `app/trust/data-handling/page.tsx`                                                                                             | static review         |
| `/trust/subprocessors`          | `app/trust/subprocessors/page.tsx`                                                                                             | static review         |
| `/trust/responsible-disclosure` | `app/trust/responsible-disclosure/page.tsx` (noindex)                                                                          | static review         |
| `/legal/cookies`                | `app/legal/cookies/page.tsx`                                                                                                   | static review         |
| `/legal/sub-processors`         | `app/legal/sub-processors/page.tsx` (noindex stub → trust)                                                                     | static review         |
| Shared chrome                   | `Shell`, `Nav`, `Footer`, `CtaBanner`, `BuiltToTrustCenter`, `VideoCard`, `TryRelayProvider`, `CookieConsent`, `AnalyticsGate` | ✅                    |

In addition, the following sitemap-listed adjacent routes were verified for existence but are out of the "4–5 page" launch scope per the brief: `/explainer`, `/pricing`, `/for/[tool]`, `/resources/*`, `/legal/privacy-policy`, `/legal/terms-of-use`, `/legal/terms-consumer`, `/legal/terms-commercial`, `/legal/dpa`, `/legal/acceptable-use`, `/brand-guidelines`, `/trust/security`.

---

## 3. Issues found

### 3.1 Broken anchor (fixed)

- **File:** `app/login/page.tsx:85`
- **Symptom:** "Learn how it works" link pointed to `/#try`. No `id="try"` exists anywhere in the codebase, so the link jumped to the homepage top with no visible target.
- **Fix applied:** Pointed to `/product` (the canonical "How it works" page used in the Nav).

### 3.2 Untracked dirs that should be git-ignored (fixed)

- **Symptom:** `qa/`, `relay-green/` (a worktree-style duplicate with its own `node_modules` and `.next`), and `.claude-tmp/` are present in the working tree and could be accidentally committed.
- **Fix applied:** Added `/qa/`, `/relay-green/`, `/.claude-tmp/` to `.gitignore`. None of these were ever staged, so this is purely preventative.

### 3.3 Footer "About" nav link goes to homepage (flag for approval — wording)

- **File:** `app/_marketing/Footer.tsx:25`
- **Symptom:** Footer primary nav "About" links to `/`, not `/company/about`. The header Nav's "About RELAY" item also links to `/`.
- **Why this matters:** A user clicking "About" expects an about page, not the homepage they already came from. The codebase has an unused `/company/about` route that is otherwise titled "Contact Us".
- **Status:** Flagged for approval (§6). May be intentional (the homepage is the company story).

### 3.4 Login metadata title uses em-dash (flag for approval — wording)

- **File:** `app/login/page.tsx:12`
- **Symptom:** `title: "Sign in — Relay.green"`. The brand follows a no-em-dash convention (see commentary in `app/for-enterprise/page.tsx:478`).
- **Status:** Flagged for approval.

### 3.5 Sub-processor duplication — both `/legal/sub-processors` and `/trust/subprocessors` exist

- **Symptom:** Two distinct pages on related content. Canonicalisation risk is mitigated because:
  - `/legal/sub-processors` is `robots: { index: false, follow: false }` (`app/legal/sub-processors/page.tsx:17`)
  - `/legal/sub-processors` declares `alternates: { canonical: "/legal/sub-processors" }` and links the user back to `/trust/subprocessors` as the source of truth
  - sitemap.ts only includes `/trust/subprocessors`
- **Status:** **No technical action needed** — the noindex + sitemap exclusion are doing the canonicalisation work. Recorded for awareness.

### 3.6 Sitemap notes

- **File:** `app/sitemap.ts`
- `/trust/responsible-disclosure` and `/trust/security` are intentionally excluded (both are `robots: { index: false }`). ✅
- `/login`, `/payment`, `/intake`, `/room`, `/widget/*`, `/sitemap-and-content-plan` are correctly disallowed in `app/robots.ts`. ✅
- `/explainer` correctly includes Google Video sitemap metadata (`videos` array). ✅

### 3.7 Unused/legacy assets in `public/` (flag for approval — cleanup)

The following files in `public/` are NOT referenced by the live marketing site as of this audit but live in a deployable directory:

| Path                                                               | Status                                                          | Recommendation                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------- |
| `next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`    | Next.js scaffold defaults, unused                               | Delete (with approval)                |
| `Relay-Explainer-90s-Production-Storyboard-v1.2.docx`              | Internal storyboard, ~doc-sized binary                          | Move out of `public/` (with approval) |
| `relay-explainer-poster.jpg`                                       | Older poster (now `relay-explainer-v6-poster.svg/jpg` are used) | Verify with team, then delete         |
| `room-w.png`, `theeme-w.png` (note: "theeme" appears to be a typo) | Design mocks referenced only in code comments                   | Verify with team, then delete         |

`relay-explainer-final-v5.mp4` and `relay-explainer-v6-cinematic.mp4` ARE referenced from `/explainer` per the existing inventory — leave them.

---

## 4. Fixes applied

### 4a. Technical fixes (no approval needed)

| #   | File                      | Change                                                                                                                                             |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `app/login/page.tsx:85`   | `href="/#try"` → `href="/product"` (broken anchor — `id="try"` does not exist anywhere)                                                            |
| 2   | `public/llms.txt:72`      | `https://www.relay.green/company/contact` → `https://www.relay.green/company/about#contact` (broken URL — `/company/contact` route does not exist) |
| 3   | `public/llms-full.txt:72` | Same fix as `llms.txt`                                                                                                                             |
| 4   | `.gitignore`              | Added `/qa/`, `/relay-green/`, `/.claude-tmp/`                                                                                                     |

### 4b. Approved changes (applied with user approval)

| #   | File                                                                                                                                                                                                                                            | Change                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `lib/seo/schema.ts:14`                                                                                                                                                                                                                          | `ORG_LEGAL_NAME` changed to `"Relay TechnoForge, Inc."` so schema.org `Organization.legalName` matches the company name in `/llms.txt` and `/llms-full.txt`                                                                                           |
| 6   | `app/login/page.tsx:10-14`                                                                                                                                                                                                                      | Metadata: removed stale "magic link" wording → `description: "Sign in to Relay.green."`; replaced em-dash in title with comma; added `alternates: { canonical: "/login" }`                                                                            |
| 7   | `app/trust/compliance/page.tsx:32-44`                                                                                                                                                                                                           | `dpo@relay.green` in the GDPR row is now a `mailto:` link (changed `detail` type to `React.ReactNode` to support inline JSX)                                                                                                                          |
| 8   | `app/legal/terms-of-use/page.tsx:19`                                                                                                                                                                                                            | Replaced em-dash in metadata description with colon (brand convention)                                                                                                                                                                                |
| 9   | All 8 trust/legal pages: `/trust`, `/trust/subprocessors`, `/legal/cookies`, `/legal/sub-processors`, `/legal/terms-of-use`, `/legal/privacy-policy`, `/legal/dpa`, `/legal/acceptable-use`, `/legal/terms-consumer`, `/legal/terms-commercial` | Bumped "Last updated: May 2026" / "State of compliance · May 2026" → June 2026                                                                                                                                                                        |
| 10  | `app/_marketing/CookieConsent.tsx:58-62`                                                                                                                                                                                                        | Cookie banner default preferences for `functional` and `analytics` now `false` (was `true`). User must explicitly opt in to each non-essential category — stricter GDPR posture. "Accept & Continue" still sets every category to `true` in one click |
| 11  | Removed route: `app/trust/security/`                                                                                                                                                                                                            | Deleted per approval. `/legal/dpa` now links to `/trust` instead. `/trust/security` references in `llms.txt`/`llms-full.txt` also removed                                                                                                             |
| 12  | Removed route: `app/legal/sub-processors/`                                                                                                                                                                                                      | Deleted per approval. `/legal/dpa` and `/legal/terms-commercial` now link to `/trust/subprocessors` directly. `/legal/sub-processors` references in `llms.txt`/`llms-full.txt` also redirected to `/trust/subprocessors`                              |
| 13  | Deleted from `public/`: `next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`, `Relay-Explainer-90s-Production-Storyboard-v1.2.docx`, `room-w.png`, `theeme-w.png`                                                                    | Unused scaffold/legacy/typo'd assets removed per approval                                                                                                                                                                                             |

No other code was modified. All discovery-level findings that would alter copy, design, animation, legal text, or destination URLs are queued in §6, §7.

### Additional issues identified during the second-pass deep inventory

| #   | Where                                                           | Finding                                                                                                                                                                                                        | Status                                                                     |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A   | `public/llms.txt` and `lib/seo/schema.ts`                       | **Legal entity name mismatch.** llms.txt names the company "Relay TechnoForge, Inc., a Delaware C-Corporation"; `schema.ts` uses "Relay.green, Inc." Same brand, two legal names on public surfaces.           | **Needs approval — legal**                                                 |
| B   | `app/login/page.tsx:13`                                         | metadata description says "Sign in to Relay.green with a magic link. No password needed." but `SignInForm.tsx` is password-first with email-OTP and OAuth (Google + GitHub) as branches. Description is stale. | **Needs approval — wording**                                               |
| C   | `app/trust/compliance/page.tsx:33`                              | `dpo@relay.green` is rendered as plain text inside the GDPR row description. Not a mailto link, so users cannot one-click contact the DPO.                                                                     | **Needs approval — wording (linkify text only)**                           |
| D   | `app/trust/page.tsx:135`, `app/trust/data-handling/page.tsx:82` | `<div className="r-num">, {s.num}</div>` renders as literal ", 01" / ", 02" etc. Intentional editorial styling per code review, but reads oddly in plain text / screen readers.                                | **Awareness only**                                                         |
| E   | `public/llms.txt:77` mentions `/trust/security`                 | Trust index page (`/trust`) only links to 4 sub-pages, not 5 — `/trust/security` is not surfaced from the Trust index even though the route exists.                                                            | **Awareness only**                                                         |
| F   | `app/product/page.tsx:47-359`                                   | ~310 lines of unused `PRODUCT_PAGE_PALETTES` color palettes shipped to the route. Only `appleMono` is consumed (line 361).                                                                                     | **Bundle hygiene — needs approval before deleting; flagged for follow-up** |
| G   | `app/_marketing/TryRelayFunnel.tsx:17, 165, 223`                | Three `TODO(auth)` / `TODO(api)` markers inside the Try Relay modal funnel — the Try Relay button is on every marketing page that uses `Shell`. Verify these are intentional placeholders or pre-launch stubs. | **Needs verification by engineering**                                      |
| H   | `app/twitter-image.tsx`                                         | Twitter card is 1200×600 (2:1). Twitter's `summary_large_image` accepts this, but the more common recommendation is 1200×675.                                                                                  | **Awareness only — no action needed**                                      |

---

## 5. SEO items already implemented (no changes needed)

| Item                                                                                                                                                                                                                                                                                    | Source                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `metadataBase`, default title, template, applicationName, authors, keywords, formatDetection                                                                                                                                                                                            | `app/layout.tsx:56-123`                                                       |
| Per-page `metadata.title`, `description`, `alternates.canonical`                                                                                                                                                                                                                        | Every reviewed page                                                           |
| `robots.txt` with allow/disallow rules, `host`, `sitemap` directive                                                                                                                                                                                                                     | `app/robots.ts`                                                               |
| `sitemap.xml` with weekly/monthly/yearly cadence, video metadata for `/explainer`, all resources auto-included                                                                                                                                                                          | `app/sitemap.ts`                                                              |
| `manifest.webmanifest` with brand-green `theme_color`, name, icons                                                                                                                                                                                                                      | `app/manifest.ts`                                                             |
| Favicon (32×32) + Apple Touch Icon (180×180) — dynamic via `ImageResponse`                                                                                                                                                                                                              | `app/icon.tsx`, `app/apple-icon.tsx`                                          |
| OpenGraph (1200×630) + Twitter (1200×600) social cards                                                                                                                                                                                                                                  | `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `lib/seo/og-template.tsx` |
| JSON-LD on every page: Organization + WebSite (global); WebPage + BreadcrumbList per page; FAQPage on /trust; Article on resources; VideoObject on /explainer                                                                                                                           | `lib/seo/schema.ts`, `app/_marketing/JsonLd.tsx`                              |
| `/llms.txt` + `/llms-full.txt` for answer-engine optimisation                                                                                                                                                                                                                           | `public/llms.txt`, `public/llms-full.txt`                                     |
| In-text mention of AI search engines and language models in footer (AEO)                                                                                                                                                                                                                | `app/_marketing/Footer.tsx:198-247`                                           |
| `apex → www` consolidation via Vercel edge + `host` directive in robots                                                                                                                                                                                                                 | `app/robots.ts:61`, `app/layout.tsx:50`                                       |
| Correct H1-per-page hierarchy (1 H1 confirmed live on `/`, `/product`, `/for-enterprise`, `/trust`)                                                                                                                                                                                     | Live test                                                                     |
| Noindex on internal/legal stub pages: `/legal/sub-processors`, `/legal/dpa`, `/legal/acceptable-use`, `/legal/terms-commercial`, `/legal/terms-consumer`, `/trust/responsible-disclosure`, `/trust/security`, `/sitemap-and-content-plan`, `/payment`, `/payment/success`, `/not-found` | Each respective `page.tsx`                                                    |

---

## 6. SEO / content items needing your approval (no changes made)

Each item below is a recommendation — none was acted on.

| Topic                                                  | Recommendation                                                                                        | Why                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Nav "About RELAY" link target                          | Consider pointing to `/company/about` instead of `/`                                                  | Current `/` link is the homepage they already navigated from; an "About" link conventionally goes to a company page |
| Footer "About" link target                             | Same as above                                                                                         | Same rationale                                                                                                      |
| `/login` metadata title `"Sign in — Relay.green"`      | Replace em-dash with comma to match brand convention                                                  | Brand convention noted in code comments                                                                             |
| `/login` metadata canonical                            | Add `alternates: { canonical: "/login" }` (optional)                                                  | Currently not declared; /login is disallowed in robots, so this is hygiene only                                     |
| Hero copy on `/` uses em-dash                          | `app/_marketing/SplineHero.tsx:64` "join your build in seconds — to debug, deploy…" — wording matter  | Brand says no em-dash; this is copy, not technical                                                                  |
| `/download-relay-desktop` placeholder copy             | Once the installer ships, replace placeholder text and re-add to sitemap                              | Currently page is honest about being a placeholder                                                                  |
| Listing `/trust/security` in sitemap                   | Decide if `/trust/security` should be indexed (currently noindex). It does carry useful trust signals | Either un-noindex + add to sitemap, or leave as gated reference                                                     |
| Schema dates ("Last updated: May 2026") on Trust pages | Bump to launch month before going live                                                                | Stale dates erode trust posture                                                                                     |
| Cleanup of unused `public/` assets (§3.7)              | Confirm OK to delete the Next.js scaffold SVGs and the legacy `Storyboard.docx`                       | These are deployed today but not served                                                                             |

---

## 7. Legal items needing your approval (no changes made)

| Item                                                                                                       | Note                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All legal pages are present and reachable from the footer/cookie-consent modal                             | Reviewed for presence only — content was not read end-to-end and no placeholder text was found, but a full legal-counsel pass is recommended before launch                                                                                                                                                      |
| `/trust/compliance` says "SOC 2 readiness work is in progress" with an April 2026 – Sept 2026 audit window | Confirm window is still accurate                                                                                                                                                                                                                                                                                |
| `/trust/data-handling` says default retention is 90 days, configurable 7d–7y                               | Confirm these numbers are current with the operations team                                                                                                                                                                                                                                                      |
| Sub-processors list (`/trust/subprocessors`): AWS, Stripe, Vercel, Datadog, Postmark, Cloudflare           | Confirm this is the complete, current list                                                                                                                                                                                                                                                                      |
| Responsible disclosure copy mentions PGP key "Available on request after initial contact"                  | Confirm this is intentional vs. publishing the fingerprint inline                                                                                                                                                                                                                                               |
| Cookie banner default consent: ANALYTICS unchecked by default in settings panel?                           | Currently `analytics: true` is the default in settings panel. GDPR strictly requires _opt-in_ — settings UI defaults to checked but consent is only persisted when user clicks "Save settings" or "Accept & Continue", so this is compliant in flow but may warrant a review for explicit-consent jurisdictions |

---

## 8. Performance status

| Item                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next/font/google` with `display: swap` for Source Serif 4, Inter, JetBrains Mono | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Spline 3D hero (`prod.spline.design`)                                             | ✅ `preconnect` + LOW-priority `preload` on the scene file; client island skipped under `prefers-reduced-motion`; CSS poster gradient covers area before WebGL mount (`SplineHero.tsx:32-42`)                                                                                                                                                                                                                                                                                                                                         |
| Hero video posters                                                                | ✅ SVG posters (`relay-explainer-v6-poster.svg`); `<video preload="metadata">`; only autoplays after user click                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Image lazy-loading                                                                | ✅ N/A — marketing scope has no raster images (all SVG icons, CSS flag backgrounds, OG cards via `next/og` runtime)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Layout shift on hero                                                              | ✅ Spline preserves space via the poster gradient                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Production stack marquee                                                          | ✅ Pure CSS animation; respects `prefers-reduced-motion` (verified in marketing.css)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FAQ disclosure                                                                    | ✅ Native `<details>/<summary>` — zero JS cost                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Analytics gating                                                                  | ✅ `@vercel/analytics` and `@vercel/speed-insights` only load after `Accept`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Bundle size — client islands                                                      | ✅ Only `SplineHero`, `VideoCard`, `Nav`, `MobileNavDrawer`, `ThemeSwitcher`, `CookieConsent`, `AnalyticsGate`, `TryRelayProvider`, `BuiltToTrustCenter`, `PressTheDot`, `ProductHeroOrb`, `ProofDotButton`, `EnterpriseCtaButton`, `TryRelayButton`, `PhaseCards`, `ManageCookiesLink`, `HeroDot`, `ExplainerMotionV6Lazy`, `ExplainerVideoLazy`, `RouteProgress`, `AosProvider`, `FloatingThemeToggle`, `ThemeProvider`, `JsonLd`, `ContactForm`, `LoginThemeSwitcher`, `SignInForm` are client components. Everything else is RSC. |

**Risk:** Spline WebGL scene is the single biggest non-text payload. It is loaded after first paint and skipped under `prefers-reduced-motion`, but the scene file itself lives on a third-party CDN. If `prod.spline.design` is slow or unreachable, the hero degrades to the poster gradient — that's the right fallback.

**Recommendation (not actioned):** Run a production-build Lighthouse pass against `https://www.relay.green` after the first deploy and set a CWV alert in Vercel Speed Insights.

---

## 9. Mobile status

Live-tested at viewport 375×812:

| Route             | H1                                                                          | Overflow           | Title                                 |
| ----------------- | --------------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| `/`               | "The human layer for AI-built software."                                    | 375 px (no scroll) | "Build with AI. Ship with engineers." |
| `/product`        | "One Press. One Engineer. From being stuck to solution ready in real time." | 375 px (no scroll) | "How it works · Relay"                |
| `/for-enterprise` | "Govern the AI your team is already using. RELAY ensures it works."         | 375 px (no scroll) | "For Enterprise · Relay"              |
| `/trust`          | "Press once. The receipts are already filed."                               | 375 px (no scroll) | "Trust center · Relay"                |
| `/login`          | "Welcome back"                                                              | 375 px (no scroll) | "Sign in — Relay.green · Relay"       |

CSS responsive breakpoints in `app/_marketing/marketing.css`:

- 480 / 600 / 640 / 720 / 768 / 880 / 900 / 980 / 1024 / 1100 / 1180 px
- 17+ separate `prefers-reduced-motion` accommodations across keyframes and transitions

Tables on `/trust/compliance` and `/trust/subprocessors` use `r-grid-table-scroll` wrapper for horizontal scroll on phones rather than column-squeeze. ✅

Mobile drawer (`MobileNavDrawer`) appears on hamburger; touch targets meet 44 px Apple HIG / 48 px Material guideline per CSS inspection (44 px nav burger, 56 px play button on VideoCard, ≥44 px mobile CTA buttons via `.cookie-btn { min-height: 42px }` etc.).

---

## 10. Browser compatibility status

No physical browser matrix was executed; the following risk areas were code-reviewed:

| Risk                                                              | Status                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@supports (animation-timeline: view())` scroll-driven animations | ✅ Used as progressive enhancement with delay-staggered fallback (e.g. `app/product/page.tsx:418-424`, `app/for-enterprise/page.tsx:303-309`) |
| `backdrop-filter` on cookie modal                                 | ✅ Vendor-prefixed (`-webkit-backdrop-filter`) at `app/_marketing/CookieConsent.tsx:198-199`                                                  |
| `text-wrap: balance`                                              | Used on hero copy. Falls back to normal wrap on older browsers. ✅ Non-fatal                                                                  |
| `clamp()` for fluid typography                                    | ✅ Universally supported in 2026 baselines                                                                                                    |
| `aspect-ratio` on VideoCard                                       | ✅ Universal                                                                                                                                  |
| `100dvh` viewport units                                           | ✅ Used on cookie modal and login page; degrades to `100vh` on older browsers                                                                 |
| `Spline` WebGL                                                    | ✅ Skipped via `prefers-reduced-motion`; falls back to CSS gradient if WebGL is unavailable                                                   |
| Video autoplay                                                    | ✅ Only autoplays AFTER user click on `VideoCard`; `playsInline` set for iOS Safari                                                           |
| `accent-color: var(--green)` on cookie checkboxes                 | ✅ Universal                                                                                                                                  |

**Recommended manual test matrix (not executed):**

1. Chrome 130+ desktop + Android — golden path
2. Safari 17+ macOS + iOS 17+ — Spline, backdrop-filter, dvh, dialog
3. Firefox 130+ desktop — animation-timeline fallback path
4. Edge 130+ desktop — should mirror Chrome
5. Older iOS Safari (15.x) — backdrop-filter degrade, 100vh fallback

---

## 11. Remaining risks

| Risk                                                                                                                                                                                                                       | Severity | Mitigation                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spline 3D hero is a third-party WebGL asset on a CDN we don't control                                                                                                                                                      | Low      | Already has poster fallback, lazy load, `prefers-reduced-motion` skip. Monitor via Speed Insights post-launch                                     |
| `/login` not part of indexed marketing surface but contains a "demo-only" comment in `lib/auth.ts` — confirm real Supabase auth is wired in prod                                                                           | Medium   | Out of scope for this audit but called out: confirm before launch that the live `/login` calls Supabase, not the cookie demo                      |
| Two terms pages (`/legal/terms-of-use` vs `/legal/terms-consumer`) exist                                                                                                                                                   | Low      | Footer links to `/legal/terms-of-use`; `/login` links to `/legal/terms-consumer`. Likely intentional (general vs. B2C signup). Confirm with legal |
| "Last updated: May 2026" dates on Trust pages will be stale by launch                                                                                                                                                      | Low      | Bump to launch month                                                                                                                              |
| Some legal pages disable indexing — confirm SEO team is happy with that                                                                                                                                                    | Low      | See §5 list                                                                                                                                       |
| `EnterpriseCtaButton` form (in `/for-enterprise`) POSTs to `/api/contact`; confirm endpoint is healthy in prod                                                                                                             | Low      | Endpoint review out of marketing-audit scope                                                                                                      |
| LAUNCH.md references `/public/_unreleased-downloads/` for code-signed installers — verify `/downloads/Relay-Setup.exe` is present before launch                                                                            | Medium   | Coordinate with deploy/code-sign pipeline                                                                                                         |
| The dev server logs a Supabase env-var error locally on `/login` — purely a local dev-env condition (no `NEXT_PUBLIC_SUPABASE_URL`), the page still renders. Verify the env var IS set on the Vercel project before launch | Medium   | `vercel env ls` check                                                                                                                             |

---

## 12. Final go-live checklist

- [ ] Confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in Vercel prod env (`vercel env ls`)
- [ ] Confirm `RESEND_API_KEY` set in Vercel prod env (transactional email for ContactForm)
- [ ] Confirm Vercel project domain settings: `relay.green` → 308 redirect to `www.relay.green`
- [ ] Run `npm run verify` (lint + typecheck + format:check) — ✅ passing locally before merge
- [ ] Run `npm run build` — confirm no build errors
- [ ] Lighthouse pass on prod URL (Performance / Accessibility / Best Practices / SEO ≥ 90)
- [ ] Run the manual cross-browser test matrix in §10
- [ ] Verify each route in §2 loads in production (no 404s)
- [ ] Test "Try Relay" modal end-to-end on prod
- [ ] Test ContactForm submission on `/company/about#contact` and confirm a real email lands at `support@relay.green`
- [ ] Test cookie banner: Accept → Vercel Analytics fires; Reject → nothing fires; Reopen via footer "Manage cookies"
- [ ] Test theme switcher (Sun/Moon/Espresso/KLM) on `/` and confirm CSS theme cascade applies and persists across navigation
- [ ] Verify `<video>` cards on `/` actually play `relay-explainer-enterprise-v1.mp4` and `relay-combine-v2b.mp4`
- [ ] Test mobile menu (hamburger → drawer) at 375 px and 414 px
- [ ] Confirm `qa/` and `relay-green/` are NOT in the deployed bundle (now git-ignored)
- [ ] Confirm `LAUNCH.md` step 1.3 (code-signed installers) before linking `/downloads/Relay-Setup.exe`
- [ ] Apply approvals from §6 and §7 OR explicitly accept the current state
- [ ] Bump "Last updated" dates on Trust pages to current month
- [ ] Lock the prod deployment (`vercel --prod`) only after every box above is checked

---

## 13. Google Search Console readiness checklist

- [ ] Verify ownership of `relay.green` and `www.relay.green` (both DNS TXT or HTML file)
- [ ] Set preferred domain to `https://www.relay.green` in property settings (matches robots `host` + canonical)
- [ ] Submit `https://www.relay.green/sitemap.xml`
- [ ] Submit `https://www.relay.green/robots.txt` (auto-discovered, but confirm parses without errors)
- [ ] Inspect URL on key pages: `/`, `/product`, `/for-enterprise`, `/trust`, `/legal/privacy-policy`, `/legal/terms-of-use` — confirm all are indexable
- [ ] Test rich results: paste `/` and `/product` URLs into the Rich Results Test, confirm Organization + WebSite + BreadcrumbList parse cleanly
- [ ] Set up Performance + Coverage email alerts
- [ ] Confirm Bing Webmaster + Yandex Webmaster mirror the same (optional but recommended)

---

## 14. Sitemap and robots status

- **`robots.txt`** (`app/robots.ts`): permissive (`allow: /`) with explicit `disallow:` for `/api/`, the legacy demo surfaces (`/customer`, `/engineer`, `/supervisor`, `/admin`, `/staff/`, etc.), `/login`, `/payment`, `/sitemap-and-content-plan`, and the static design alts in `/public/aaklmblue/` + `/public/espresso/`. Declares `sitemap: https://www.relay.green/sitemap.xml` and `host: https://www.relay.green`. ✅
- **`sitemap.xml`** (`app/sitemap.ts`): emits the static marketing routes (with priorities + change frequencies) plus dynamic resource entries from `app/resources/_data/posts.ts`. `/explainer` carries Google video sitemap metadata. ✅
- **Static SVG/HTML alts** in `/public/aaklmblue/` and `/public/espresso/`: confirmed disallowed in `robots.ts:55-56`.

---

## 15. Recommended post-launch monitoring

1. **Vercel Speed Insights** — already wired via `AnalyticsGate` post-consent. Set CWV alerts in the Vercel dashboard (LCP < 2.5 s, INP < 200 ms, CLS < 0.1) on the marketing routes.
2. **Vercel Analytics** — already wired post-consent. Add custom event for "Try Relay opened" if not already tracked.
3. **GSC Coverage** — weekly check of indexing health and crawl errors.
4. **404 monitoring** — wire `app/not-found.tsx` to log a beacon (Sentry / Vercel Logs / etc.) so silent broken links surface.
5. **Form submission alerting** — confirm Resend webhook on `/api/contact` triggers an internal Slack/email on every successful lead.
6. **Spline scene watchdog** — alert if `prod.spline.design` returns 5xx for > 1 min. Hero degrades to gradient but a paying visitor expectation is the animated hero.
7. **Cookie banner conversion** — track Accept-rate vs. Reject-rate to validate the GDPR posture isn't tanking analytics fidelity.
8. **Mobile vs. desktop split** — confirm mobile bounce rate stays in line with desktop after launch (375 px QA passed; real-world devices may surface long-tail issues).

---

## 16. Final verdict

**READY.**

After applying all approval items (see §4b), the marketing surface is technically launch-ready:

- Zero broken internal links.
- Zero missing/broken assets.
- Zero exposed secrets, localhost references, or console-log noise in marketing scope.
- Comprehensive SEO infrastructure (robots, sitemap, manifest, OG, Twitter, JSON-LD, AEO via `/llms.txt`).
- Strong accessibility baseline (single H1 per page, no empty alt, native semantics, ARIA on modals, `prefers-reduced-motion`).
- Mobile rendering verified at 375 px on all critical pages.
- Cookie consent + analytics gating compliant with GDPR/DPDP/CCPA flow — **defaults now flipped to opt-in** per approval.
- Legal entity name consistent across schema.org and `/llms.txt`.
- All trust/legal "Last updated" stamps bumped to June 2026.
- `/trust/security` and `/legal/sub-processors` removed; references redirected.
- Eight unused public assets removed.
- DPO contact is now a clickable mailto link.

**Remaining for the deploy operator (you):**

1. Run the §12 go-live checklist in production. The env-var checks are the most critical: confirm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `RESEND_API_KEY` are set on the Vercel project.
2. Run `npm run build` locally or in CI to confirm the production build succeeds.
3. Run a Lighthouse pass on the prod URL post-deploy.
4. Trigger the prod deploy (`vercel --prod` or the CI workflow). Per the deploy-approval rule, I will not run any deploy command myself.

Three known items kept as **known and shipping as-is** per approval:

- `TODO(auth)`/`TODO(api)` markers in `TryRelayFunnel.tsx` lines 17, 165, 223 — confirmed to be deferred to a post-launch sprint.
- Nav + Footer "About" link continues to point to `/` (the homepage is the company story).
- Em-dashes in `SplineHero` hero copy remain (intentional editorial choice not flagged for fix).

---

_End of report._
