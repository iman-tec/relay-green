/*
 * Seed content for the RAG test project (see seed-rag-test.ts).
 *
 * One customer project — "PlatePal — AI Meal Planning App" — with 7 detailed
 * sessions portraying the whole Relay journey: a semi-technical founder hits a
 * wall on an AI-built app, clicks Relay, gets an engineer, and ships the
 * project together over 7 sessions.
 *
 * The content is deliberately dense with SPECIFIC, verifiable facts (error
 * codes, env var names, prices, row counts, dates, metrics) so the RAG
 * assistant can be probed for hallucination: every answer it gives should be
 * traceable to a fact planted here.
 */

export const CUSTOMER_NAME = "Rohan Mehta";
export const ENGINEER_NAME = "Marcus Webb";
export const PROJECT_NAME = "PlatePal — AI Meal Planning App";

export type SeedMessage = {
  from: "c" | "e";
  body: string;
  /** Name of a file (from SeedSession.files) attached to this message. */
  attach?: string;
};

export type SeedCaption = { who: "c" | "e"; text: string };

export type SeedFile =
  | { name: string; mime: "text/plain"; kind: "document"; content: string }
  | {
      name: string;
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      kind: "document";
      sheets: Record<string, (string | number)[][]>;
    };

export type SeedSession = {
  /** ISO datetime of session start (UTC). */
  startsAt: string;
  durationMinutes: number;
  title: string;
  overview: string;
  nextSteps: string[];
  summary: string;
  chat: SeedMessage[];
  captions: SeedCaption[];
  files: SeedFile[];
};

// ───────────────────────────────────────────────────────────────────────────
// Session 1 — Apr 14, 2026 · Magic-link login loop (the "issue intake")
// ───────────────────────────────────────────────────────────────────────────
const S1: SeedSession = {
  startsAt: "2026-04-14T14:05:00Z",
  durationMinutes: 38,
  title: "Magic-link login loop on Vercel deploy",
  overview:
    "Rohan's Lovable-built meal-planning app (PlatePal) broke at the worst moment — beta testers clicking the Supabase magic-link email got bounced straight back to the login page in an endless loop. Production is on Vercel at platepal-beta.vercel.app, supabase-js v2.43.1. Marcus traced it to three stacked causes: NEXT_PUBLIC_SITE_URL was still set to http://localhost:3000 in the Vercel production env, the callback URL https://platepal-beta.vercel.app/auth/callback was missing from the Supabase Auth redirect allowlist, and several testers opened the link inside Gmail's in-app browser which breaks the PKCE flow state (AuthApiError: invalid flow state, status 422). All three fixed live on the call; login confirmed working from a fresh incognito session and from a real phone.",
  nextSteps: [
    "Rohan to rotate the Supabase anon key (it was visible in a public Loom video)",
    "Marcus to write up a staging-project setup so prod env vars never get tested against localhost again",
    "Add an /auth/callback route that calls exchangeCodeForSession instead of relying on detectSessionInUrl",
  ],
  summary:
    "Fixed the production magic-link login loop: corrected NEXT_PUBLIC_SITE_URL in Vercel (was http://localhost:3000), added https://platepal-beta.vercel.app/auth/callback to the Supabase redirect allowlist, and explained the PKCE 'invalid flow state' (422) error caused by Gmail's in-app browser. Verified login works end-to-end.",
  chat: [
    { from: "c", body: "Hi! I'm honestly a bit desperate. I built a meal planning app called PlatePal with Lovable, it worked fine for weeks, and now NOBODY can log in. People click the magic link in their email and just get thrown back to the login page. I have 30 beta testers starting today." },
    { from: "e", body: "Hey Rohan, I'm Marcus — let's get this sorted. First things first: where is the app deployed, and what auth provider are you on?" },
    { from: "c", body: "It's on Vercel — platepal-beta.vercel.app. Auth is Supabase magic links (email OTP). The stack Lovable generated is Next.js + Supabase + Tailwind." },
    { from: "e", body: "Got it. Open the browser devtools console on the login page, click a magic link, and paste me whatever errors show up. Also tell me which supabase-js version is in package.json." },
    { from: "c", body: "package.json says \"@supabase/supabase-js\": \"^2.43.1\". Console shows: AuthApiError: invalid flow state, no valid flow state found — status 422. Then it redirects to /login." },
    { from: "e", body: "That 422 'invalid flow state' is a PKCE error — the browser that OPENS the magic link doesn't have the code_verifier that the browser that REQUESTED it stored. Classic causes: link opened in a different browser (e.g. Gmail's in-app browser on mobile), or your redirect URL config is wrong so the flow restarts. Let's check config first." },
    { from: "e", body: "Go to your Vercel project → Settings → Environment Variables. What is NEXT_PUBLIC_SITE_URL set to for Production?" },
    { from: "c", body: "Oh. It says http://localhost:3000. Is that bad? Lovable must have set it when I exported the project." },
    { from: "e", body: "That's cause #1. Your magic-link emails are telling Supabase to send users back to localhost — they bounce, the flow state dies, you get the 422 on the retry. Change it to https://platepal-beta.vercel.app and redeploy." },
    { from: "c", body: "Changed and redeploying now. Vercel says ~50 seconds." },
    { from: "e", body: "While that builds: Supabase Dashboard → Authentication → URL Configuration. The Site URL should be https://platepal-beta.vercel.app and under 'Redirect URLs' you need https://platepal-beta.vercel.app/auth/callback. Is the callback in the allowlist?" },
    { from: "c", body: "Site URL was still localhost too 🤦 and the Redirect URLs list is empty. Adding both now." },
    { from: "e", body: "That's cause #2. With an empty allowlist Supabase silently falls back to the Site URL, so even a correct emailRedirectTo gets rewritten. Save it and send yourself a fresh magic link — old links are burned, they carry the old redirect." },
    { from: "c", body: "Sent a new one… clicking… IT WORKS. I'm in the dashboard. Oh my god. Let me try on my phone too." },
    { from: "c", body: "Phone fails 😞 Same login bounce. I opened the link from the Gmail app." },
    { from: "e", body: "That's cause #3 and it's the PKCE one: Gmail's in-app browser is a separate browser context, so the code_verifier saved by Safari/Chrome isn't there. Two fixes: (a) add a dedicated /auth/callback route handler that calls supabase.auth.exchangeCodeForSession(code) server-side, or (b) switch that flow to an 8-digit email OTP instead of a link. For your launch today, (a) is a 15-minute change." },
    { from: "e", body: "Here's the route — create app/auth/callback/route.ts:\n\n```ts\nimport { NextResponse } from \"next/server\";\nimport { createClient } from \"@/lib/supabase/server\";\n\nexport async function GET(req: Request) {\n  const { searchParams, origin } = new URL(req.url);\n  const code = searchParams.get(\"code\");\n  if (code) {\n    const supabase = await createClient();\n    await supabase.auth.exchangeCodeForSession(code);\n  }\n  return NextResponse.redirect(`${origin}/dashboard`);\n}\n```" },
    { from: "c", body: "Added, committed, deployed. Testing from Gmail on the phone… works!! Both browsers. You're a wizard." },
    { from: "e", body: "One more thing I noticed while you screen-shared: your Loom walkthrough video from last week shows the Supabase anon key on screen. The anon key is public-ish by design but combined with your empty redirect allowlist it was risky. Rotate it this week: Supabase → Settings → API → 'Generate new anon key', then update the Vercel env." },
    { from: "c", body: "Will do. Honestly I had no idea env vars were environment-specific on Vercel. Lovable hides all this." },
    { from: "e", body: "Totally normal — that's the gap between 'AI got me to a demo' and 'this survives real users'. I'm attaching nothing today, but please grab the Vercel function logs from the failure window and drop them here so we have a record of the timeline for your post-mortem." },
    { from: "c", body: "Here are the logs from this morning, 09:12 to 09:30 UTC — you can see the redirect storm.", attach: "auth-error-log.txt" },
    { from: "e", body: "Perfect, saved. Summary of today: 3 root causes — localhost NEXT_PUBLIC_SITE_URL in Vercel prod, empty Supabase redirect allowlist, and PKCE flow-state loss in Gmail's in-app browser — all fixed. Next session let's look at your database schema; I saw a table called user_data in your screen share that worries me a little 😄" },
    { from: "c", body: "Haha yes, everything lives in that one table. Booking the next session for next Tuesday. Thank you SO much Marcus — beta is unblocked." },
  ],
  captions: [
    { who: "c", text: "So basically every single beta tester is locked out. They click the link in the email and it just loops back to the login screen. I've got thirty people starting the beta today and I'm panicking a little." },
    { who: "e", text: "Okay, take a breath — login loops after a deploy are almost always configuration, not code. Can you share your screen and open the Vercel dashboard? I want to see the production environment variables first." },
    { who: "c", text: "Sharing now. This is the Vercel project, platepal-beta. Here are the environment variables… there's the Supabase URL, the anon key, and… NEXT_PUBLIC_SITE_URL." },
    { who: "e", text: "There it is — NEXT_PUBLIC_SITE_URL is set to http localhost three thousand. Your emails are literally redirecting users to a server that only exists on your laptop. That's the first problem. Change it to the real Vercel URL." },
    { who: "e", text: "Now while it redeploys, let's open the Supabase dashboard, Authentication, URL Configuration. See how the Site URL is also localhost, and the redirect allowlist is completely empty? Supabase needs the callback URL whitelisted or it rewrites the redirect." },
    { who: "c", text: "Okay I've set the site URL to platepal-beta dot vercel dot app and added the auth callback path to the redirect list. Sending myself a fresh magic link now… and… I'm in! It went straight to the dashboard." },
    { who: "e", text: "Great. Now the error your testers saw — invalid flow state, status four twenty-two — that's a PKCE error. The login flow stores a secret called the code verifier in the browser that requested the link. If a different browser opens the link, the verifier is missing and Supabase rejects the exchange." },
    { who: "c", text: "That explains the phone failures — everyone opens email in the Gmail app and that has its own built-in browser, right? So the verifier is in Safari but Gmail's browser opens the link." },
    { who: "e", text: "Exactly. The robust fix is a server-side callback route that exchanges the code for a session without needing the verifier in that browser. I'll paste the code in chat — it's about fifteen lines, an app router route handler at slash auth slash callback." },
    { who: "c", text: "Deployed. Trying from my phone, from inside Gmail… it works. Both paths work now. Honestly I would have burned the whole weekend on this." },
    { who: "e", text: "One security note before we wrap: your Loom demo from last week has the anon key on screen at around the two-minute mark. Rotate it this week. And drop the Vercel failure logs into the chat so the timeline is on record for your post-mortem." },
    { who: "c", text: "Uploading the log file now. And I'll book next Tuesday — you mentioned wanting to look at my database. Fair warning, it's one giant table called user underscore data with a JSON column. Don't laugh." },
  ],
  files: [
    {
      name: "auth-error-log.txt",
      mime: "text/plain",
      kind: "document",
      content: `PlatePal — Vercel function logs (production)
Window: 2026-04-14 09:12–09:30 UTC
Deployment: platepal-beta.vercel.app  (dpl_4Yt9pKjQ2)

09:12:04.118  GET  /login                      200  142ms
09:12:31.902  GET  /?code=88f3a1c2-...          307  18ms   -> /login
09:12:32.441  [error] AuthApiError: invalid flow state, no valid flow state found
              status: 422  code: flow_state_not_found
              at exchangeCodeForSession (node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:412:19)
09:13:10.227  GET  /?code=88f3a1c2-...          307  16ms   -> /login   (retry, same code: burned)
09:14:55.610  GET  /login                       200  98ms
09:15:02.881  POST /api/auth/magic-link         200  301ms  (resend, user: tester04@yopmail.com)
09:15:40.119  GET  http://localhost:3000/?code=...   (CLIENT-SIDE — captured from tester screenshot:
              email link points at localhost:3000 — NEXT_PUBLIC_SITE_URL misconfigured)
09:18:22.343  [error] AuthApiError: invalid flow state  (x11 — testers in Gmail in-app browser)
09:27:48.001  Summary of window: 31 failed logins, 0 successful, 11 distinct users affected.

Root causes confirmed on Relay session 2026-04-14:
  1. NEXT_PUBLIC_SITE_URL=http://localhost:3000 in Vercel production env
  2. Supabase Auth redirect allowlist empty (callback URL not whitelisted)
  3. PKCE code_verifier loss in Gmail in-app browser (fixed via /auth/callback
     route calling exchangeCodeForSession server-side)
`,
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Session 2 — Apr 21, 2026 · Schema redesign + RLS
// ───────────────────────────────────────────────────────────────────────────
const S2: SeedSession = {
  startsAt: "2026-04-21T14:00:00Z",
  durationMinutes: 52,
  title: "Database schema redesign and RLS rollout",
  overview:
    "Lovable had stuffed all of PlatePal's data into a single user_data table with one big JSON column — no relations, no RLS, every row readable by every signed-in user. Marcus and Rohan designed a proper 7-table schema: profiles, dietary_profiles, recipes (14 columns incl. macros kcal/protein_g/carbs_g/fat_g), meal_plans, plan_entries, pantry_items and shopping_list_items, with a meal_slot enum (breakfast/lunch/dinner/snack) and a composite unique constraint on plan_entries (meal_plan_id, day_of_week, meal_slot). Owner-only RLS policies everywhere, plus public read on recipes where is_public = true. The migration script moved 1,847 rows out of user_data with zero data loss (row-count checksums matched). Full schema captured in PlatePal_DB_Schema.xlsx.",
  nextSteps: [
    "Rohan to run the migration on production Sunday night (low traffic) after a pg_dump backup",
    "Drop the legacy user_data table after 2 weeks of parallel-running",
    "Marcus to review the Stripe integration plan next session — Pro and Family tiers",
  ],
  summary:
    "Replaced the Lovable-generated single-table design (user_data + JSON blob) with a 7-table relational schema with owner-only RLS and a public-recipes carve-out. Migrated 1,847 rows with verified checksums. Schema documented in PlatePal_DB_Schema.xlsx (sheets: Tables, Columns, RLS_Policies).",
  chat: [
    { from: "c", body: "Morning Marcus! Beta week went great after the auth fix — 28 of 30 testers active. As promised, here's my shameful secret: the entire database is one table called user_data with columns id, user_id, and data (jsonb). Everything — recipes, meal plans, pantry — lives in that JSON." },
    { from: "e", body: "Morning! Honestly it's the most common thing I see with AI-generated apps. It works until you need queries, and you already need queries. Worse: is there any Row Level Security on it?" },
    { from: "c", body: "I checked like you asked — RLS is enabled but the only policy is `USING (true)` for authenticated. So… any logged-in user can read everyone's data?" },
    { from: "e", body: "Yes. Any beta tester could open devtools and read all 30 users' meal plans and pantry contents right now. Let's fix the model and the security in one pass. Tell me the core objects in the app." },
    { from: "c", body: "Users have a dietary profile (allergies, diet type, calorie target). They browse or create recipes. They generate weekly meal plans — 7 days, breakfast/lunch/dinner/snack slots. A pantry of ingredients they own, and a shopping list generated from plan minus pantry." },
    { from: "e", body: "Clean domain. Here's the 7-table design:\n\n1. **profiles** — 1:1 with auth.users (display_name, avatar_url)\n2. **dietary_profiles** — diet_type, calorie_target, allergies text[], user_timezone\n3. **recipes** — the big one, 14 columns: id, user_id, title, description, cuisine, servings, prep_minutes, kcal, protein_g, carbs_g, fat_g, ingredients jsonb, steps jsonb, is_public\n4. **meal_plans** — user_id, week_start date, status\n5. **plan_entries** — meal_plan_id, day_of_week (0-6), meal_slot enum, recipe_id, servings_override\n6. **pantry_items** — user_id, ingredient_slug, quantity, unit\n7. **shopping_list_items** — user_id, meal_plan_id, ingredient_slug, quantity, unit, checked" },
    { from: "c", body: "meal_slot enum — what values?" },
    { from: "e", body: "CREATE TYPE meal_slot AS ENUM ('breakfast','lunch','dinner','snack'). And on plan_entries we add UNIQUE (meal_plan_id, day_of_week, meal_slot) so a plan can't have two dinners on Tuesday — your current JSON has exactly that bug in 3 of the plans I sampled." },
    { from: "c", body: "Ha! Yes, testers reported duplicate dinners and I couldn't figure out where they came from." },
    { from: "e", body: "RLS policy pattern, same for every table: owner-only.\n\n```sql\nALTER TABLE recipes ENABLE ROW LEVEL SECURITY;\nCREATE POLICY \"own rows\" ON recipes\n  FOR ALL USING (user_id = auth.uid())\n  WITH CHECK (user_id = auth.uid());\n```\n\nPlus ONE extra read policy on recipes only:\n\n```sql\nCREATE POLICY \"public recipes readable\" ON recipes\n  FOR SELECT USING (is_public = true);\n```\n\nThat's your future community-recipes feature, already secured." },
    { from: "c", body: "How do we get the data out of the JSON blob? There are a few thousand rows of stuff in there now." },
    { from: "e", body: "Migration script with jsonb_to_recordset. I'll write it live — sharing my screen. We extract recipes first, then plans, then entries that reference the new recipe ids via a temp mapping table, then pantry. Each step ends with a count comparison against the JSON source." },
    { from: "c", body: "Watching. … That jsonb_path_query trick for the nested plan entries is black magic." },
    { from: "e", body: "Done — dry run on a branch database copied from prod. Results: recipes 412, meal_plans 188, plan_entries 1,031, pantry_items 167, dietary_profiles 28, shopping_list_items 21. Total 1,847 rows migrated, checksums match the JSON source on every entity. Zero orphans." },
    { from: "c", body: "1,847 rows out of one JSON column. Amazing. When should I run it on prod?" },
    { from: "e", body: "Sunday night your time — your analytics show traffic bottoms out 23:00–02:00. Take a pg_dump first (I put the exact command in the runbook), run the migration, keep user_data read-only for 2 weeks as a safety net, then drop it." },
    { from: "c", body: "What about indexes? You mentioned the recipe list query was slow last week." },
    { from: "e", body: "Two to start: CREATE INDEX idx_recipes_user_created ON recipes (user_id, created_at DESC) for the 'my recipes' list, and CREATE INDEX idx_plan_entries_plan ON plan_entries (meal_plan_id). We'll measure before adding more — indexes aren't free on writes." },
    { from: "e", body: "I've put the whole design into a spreadsheet — three sheets: Tables (the 7 tables + row counts), Columns (every column with type and constraint), RLS_Policies (each policy with its USING clause). Keep it as the living schema doc.", attach: "PlatePal_DB_Schema.xlsx" },
    { from: "c", body: "Downloaded. This is honestly better documentation than anything Lovable ever gave me." },
    { from: "c", body: "One more thing — I want to start charging soon. Stripe? My idea: Free tier limited to 3 meal plans a month, a Pro tier around $9.99, maybe a Family tier later." },
    { from: "e", body: "Good instinct on the limits-based free tier. Let's do Stripe properly next session: Products + Prices in test mode, a webhook handler (this is where everyone gets burned — raw body signatures), and the customer portal so you never build a cancel flow by hand. Book it for next Tuesday, same time." },
    { from: "c", body: "Booked. Running the migration Sunday 23:30 with the runbook. If anything explodes I'm pressing the green dot 😅" },
    { from: "e", body: "That's what it's for. The runbook has a rollback section — pg_restore from the dump puts you back in under 10 minutes worst case." },
  ],
  captions: [
    { who: "c", text: "Okay so don't laugh — I'm sharing my Supabase table editor. That's it. One table. user underscore data. The data column is a JSON blob that has recipes, plans, pantry, everything mixed together per user." },
    { who: "e", text: "I see it. And I want to show you something scarier than the schema — watch this. I'm logged in as my test account, and I can select star from user data and read every row. Your only policy is using true. Every beta tester can read every other tester's data." },
    { who: "c", text: "Oh no. Okay. So we're fixing structure and security at the same time. What does the right shape look like for an app like mine?" },
    { who: "e", text: "Seven tables. Profiles, dietary profiles, recipes, meal plans, plan entries, pantry items, shopping list items. Recipes is the widest at fourteen columns, including the macros — kcal, protein, carbs, fat, all numeric so you can actually sum a day's nutrition in SQL instead of in JavaScript." },
    { who: "e", text: "Plan entries gets a composite unique constraint — meal plan id, day of week, meal slot. That makes the duplicate-dinner bug your testers reported structurally impossible. The database simply won't accept a second dinner for the same day." },
    { who: "c", text: "I love that the bug becomes impossible rather than just handled. Okay, and meal slot is an enum with breakfast, lunch, dinner, snack. What about my future community recipes idea — public recipes other people can browse?" },
    { who: "e", text: "One extra select policy on recipes only: anyone can read rows where is public is true. Owner-only for everything else. That's the whole security model — two policy shapes across seven tables." },
    { who: "e", text: "Now the migration. I'm writing it live — jsonb to recordset explodes each user's JSON into rows. We do recipes first because plan entries need to reference the new recipe IDs, so there's a temporary mapping table from old JSON keys to new UUIDs." },
    { who: "c", text: "And you're checking counts at every step… recipes four hundred twelve, plans one eighty-eight, entries one thousand thirty-one… total eighteen forty-seven rows. Checksums match. That is so much more careful than I would have been." },
    { who: "e", text: "Always count and checksum. Run it Sunday night during your traffic trough, after a pg dump. Keep the old table read-only for two weeks, then drop it. The runbook I'm sending has a ten-minute rollback path if anything looks wrong." },
    { who: "c", text: "Perfect. And I mentioned in chat — next session I want to set up Stripe. Free tier with three plans a month, Pro at nine ninety-nine. Maybe a Family plan at some point." },
    { who: "e", text: "Family tier is worth doing day one actually — shared meal plans are a natural multiplayer feature and the price anchor helps Pro conversion. We'll set both up in test mode next week, and I'll show you the raw-body webhook signature trap before it bites you." },
  ],
  files: [
    {
      name: "PlatePal_DB_Schema.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "document",
      sheets: {
        Tables: [
          ["table", "purpose", "rows_after_migration", "rls"],
          ["profiles", "1:1 with auth.users — display_name, avatar_url", 28, "owner-only"],
          ["dietary_profiles", "diet_type, calorie_target, allergies[], user_timezone", 28, "owner-only"],
          ["recipes", "user + community recipes, macros per serving (14 columns)", 412, "owner-only + public read where is_public"],
          ["meal_plans", "one per user per week (week_start date)", 188, "owner-only"],
          ["plan_entries", "slot assignments; UNIQUE(meal_plan_id, day_of_week, meal_slot)", 1031, "owner-only via parent"],
          ["pantry_items", "ingredient_slug, quantity, unit", 167, "owner-only"],
          ["shopping_list_items", "generated from plan minus pantry", 21, "owner-only"],
          ["TOTAL", "", 1847, ""],
        ],
        Columns: [
          ["table", "column", "type", "constraint"],
          ["recipes", "id", "uuid", "PK default gen_random_uuid()"],
          ["recipes", "user_id", "uuid", "FK auth.users, NOT NULL"],
          ["recipes", "title", "text", "NOT NULL"],
          ["recipes", "description", "text", ""],
          ["recipes", "cuisine", "text", ""],
          ["recipes", "servings", "int", "CHECK (servings > 0)"],
          ["recipes", "prep_minutes", "int", ""],
          ["recipes", "kcal", "numeric", "per serving"],
          ["recipes", "protein_g", "numeric", "per serving"],
          ["recipes", "carbs_g", "numeric", "per serving"],
          ["recipes", "fat_g", "numeric", "per serving"],
          ["recipes", "ingredients", "jsonb", "[{slug, qty, unit}]"],
          ["recipes", "steps", "jsonb", "ordered string array"],
          ["recipes", "is_public", "boolean", "default false"],
          ["plan_entries", "meal_plan_id", "uuid", "FK meal_plans ON DELETE CASCADE"],
          ["plan_entries", "day_of_week", "int", "CHECK (0..6)"],
          ["plan_entries", "meal_slot", "meal_slot enum", "breakfast|lunch|dinner|snack"],
          ["plan_entries", "recipe_id", "uuid", "FK recipes"],
          ["plan_entries", "servings_override", "int", "nullable"],
          ["dietary_profiles", "diet_type", "text", "omnivore|vegetarian|vegan|keto|halal|kosher"],
          ["dietary_profiles", "calorie_target", "int", ""],
          ["dietary_profiles", "allergies", "text[]", "default '{}'"],
          ["dietary_profiles", "user_timezone", "text", "IANA tz, added 2026-05-29"],
        ],
        RLS_Policies: [
          ["table", "policy", "clause"],
          ["ALL TABLES", "own rows", "FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())"],
          ["recipes", "public recipes readable", "FOR SELECT USING (is_public = true)"],
          ["plan_entries", "via parent plan", "USING (EXISTS (SELECT 1 FROM meal_plans mp WHERE mp.id = meal_plan_id AND mp.user_id = auth.uid()))"],
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Session 3 — Apr 28, 2026 · Stripe subscriptions
// ───────────────────────────────────────────────────────────────────────────
const S3: SeedSession = {
  startsAt: "2026-04-28T14:00:00Z",
  durationMinutes: 47,
  title: "Stripe subscriptions: Pro + Family tiers and the webhook signature bug",
  overview:
    "Built PlatePal's monetization on Stripe (test mode): Free tier capped at 3 meal plans/month, Pro at $9.99/mo with a 7-day trial (price_1RPplPro999), and Family at $24.99/mo for up to 5 members (price_1RPplFam2499). Checkout via stripe.checkout.sessions.create, subscription state synced through a webhook handling checkout.session.completed and customer.subscription.updated, and the Stripe-hosted customer portal for cancellations. The session's main battle: the webhook returned 400 'No signatures found matching the expected signature for payload' — root cause was Next.js parsing the JSON body before verification (fix: await req.text() and constructEvent on the raw string) compounded by Rohan using the dashboard webhook secret while testing through the Stripe CLI, which issues its own whsec_. Verified live with test card 4242 4242 4242 4242; subscription row landed in the new subscriptions table.",
  nextSteps: [
    "Rohan to flip Stripe to live mode keys once the bank account clears verification",
    "Enforce the Free-tier 3-plans/month cap server-side (count meal_plans where created_at > start of month)",
    "Next session: performance — Lighthouse is at 38, hero image alone is 4.8 MB",
  ],
  summary:
    "Implemented Stripe subscriptions: Pro $9.99/mo (price_1RPplPro999, 7-day trial) and Family $24.99/mo (price_1RPplFam2499). Fixed webhook 400 signature error (raw body via req.text() + CLI whsec_ vs dashboard secret mixup). Customer portal enabled; test card 4242 verified end-to-end.",
  chat: [
    { from: "c", body: "Migration went perfectly Sunday btw — 23:41 to 23:58, all counts matched, app worked Monday morning. user_data is read-only now. Today: money! 💸" },
    { from: "e", body: "Beautiful. Stripe day. Plan from last week: Free (3 meal plans/month), Pro $9.99/mo, Family $24.99/mo up to 5 members. Adding one thing: a 7-day trial on Pro — meal planning shows its value after one full week, so trials convert well here." },
    { from: "c", body: "Love it. I created the products in the Stripe test dashboard like you asked: Pro is price_1RPplPro999 and Family is price_1RPplFam2499. Publishable and secret keys are in Vercel env (test mode)." },
    { from: "e", body: "Good. Architecture: a /api/checkout route creates the Checkout Session, Stripe hosts the payment page, then a /api/stripe/webhook route receives events and writes a subscriptions table row. NEVER trust the success redirect — only the webhook. Users can close the tab between paying and redirecting." },
    { from: "c", body: "Subscriptions table — new migration?" },
    { from: "e", body: "Yes, small one:\n\n```sql\nCREATE TABLE subscriptions (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id uuid NOT NULL REFERENCES auth.users(id),\n  stripe_customer_id text NOT NULL,\n  stripe_subscription_id text UNIQUE,\n  tier text NOT NULL CHECK (tier IN ('pro','family')),\n  status text NOT NULL,\n  current_period_end timestamptz,\n  created_at timestamptz DEFAULT now()\n);\n```\n\nOwner-only RLS, same pattern as last week." },
    { from: "c", body: "Done, applied. Checkout route is in — copying your snippet with mode: 'subscription', trial_period_days: 7 on the Pro price only." },
    { from: "e", body: "Now the webhook. Fair warning: this is the single most common Stripe failure I see on Relay calls. Write the handler, then run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and trigger a test checkout." },
    { from: "c", body: "Handler written… running stripe listen… triggering checkout with the test card 4242 4242 4242 4242… and the webhook says 400. Terminal: 'Webhook Error: No signatures found matching the expected signature for payload.'" },
    { from: "e", body: "Right on schedule 😄 Two stacked problems, let's peel them. First: paste your handler's first 5 lines." },
    { from: "c", body: "```ts\nexport async function POST(req: Request) {\n  const body = await req.json();\n  const sig = req.headers.get(\"stripe-signature\")!;\n  const event = stripe.webhooks.constructEvent(JSON.stringify(body), sig, process.env.STRIPE_WEBHOOK_SECRET!);\n```" },
    { from: "e", body: "There's bug #1: `await req.json()` then re-stringifying. Stripe signs the EXACT raw bytes. JSON.parse → JSON.stringify reorders/re-spaces them, so the signature can never match. Use the raw text:\n\n```ts\nconst payload = await req.text();\nconst sig = req.headers.get(\"stripe-signature\")!;\nconst event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET!);\n```" },
    { from: "c", body: "Changed… still 400! Same error." },
    { from: "e", body: "Bug #2: which secret is in STRIPE_WEBHOOK_SECRET? You created a webhook endpoint in the dashboard earlier, right? The dashboard endpoint has its own whsec_… but `stripe listen` generates a DIFFERENT temporary whsec_ and prints it when it starts. While testing through the CLI you must use the CLI's secret." },
    { from: "c", body: "Ohhh. The CLI printed 'Your webhook signing secret is whsec_d8f…' and I ignored it because I'd already set the dashboard one. Swapping in .env.local… retrying checkout… ✅ 200! And there's a row in subscriptions — tier 'pro', status 'trialing', current_period_end May 5." },
    { from: "e", body: "That 'trialing' status is the 7-day trial doing its thing. Now handle the second event — customer.subscription.updated — to keep status and current_period_end in sync (renewals, cancellations, payment failures all arrive through it). Switch on event.type, upsert by stripe_subscription_id." },
    { from: "c", body: "Added. Also enabled the customer portal in the dashboard like you said — Settings → Billing → Customer portal. The /account page just links to a portal session now. I cannot believe I almost built a cancellation flow by hand." },
    { from: "e", body: "Everyone almost does. Last piece: enforce the Free cap server-side. The UI hiding the button is not enforcement — count their meal_plans where created_at >= date_trunc('month', now()) and reject the 4th create with a 402 unless subscriptions has an active/trialing row." },
    { from: "c", body: "Done in the create-plan route. I'm attaching my debug log from the webhook saga — the failed 400s and the final 200 — for the project record like last time.", attach: "stripe-webhook-debug.txt" },
    { from: "e", body: "Saved. Recap: Pro $9.99 w/ 7-day trial (price_1RPplPro999), Family $24.99 (price_1RPplFam2499), webhook fixed (raw body + CLI secret), portal live, free cap enforced server-side. When the bank verification clears, swap test keys for live keys in Vercel and create the live-mode webhook endpoint — its whsec_ goes in the prod env." },
    { from: "c", body: "Bank says 2-3 business days. Next week: the app feels SLOW. My cofounder's phone takes like 7 seconds to show the landing page. See you Tuesday!" },
    { from: "e", body: "Lighthouse first, opinions second 😄 Have the prod URL ready and we'll profile it live. I already suspect that beautiful 4.8 MB hero PNG I saw during your screen share." },
  ],
  captions: [
    { who: "c", text: "Quick win report before we start — the migration ran Sunday night, took seventeen minutes, every count matched, and nobody noticed a thing Monday morning. Okay. Today we make money. I set up the two products in Stripe test mode like you asked." },
    { who: "e", text: "Perfect. So the shape of every solid Stripe integration is the same: checkout creates the session, Stripe hosts the payment page, and a webhook is the single source of truth for what the customer actually paid for. The redirect back to your site is just decoration — never trust it." },
    { who: "c", text: "Because someone can pay and then close the tab before the redirect, right? So if I only listen to the redirect I'd have money but no record. Okay, the subscriptions table migration is applied. Writing the checkout route now from your snippet." },
    { who: "e", text: "Right. And we put a seven-day trial on Pro only — trial period days seven on that price. Meal planning is a weekly habit product, people need one full week to feel the value, so trials convert much better than discounts here." },
    { who: "c", text: "Okay, webhook handler written, stripe listen is forwarding, doing a test checkout with the four two four two card… and… four hundred. No signatures found matching the expected signature for payload. You literally predicted this exact error." },
    { who: "e", text: "It's the most common Stripe bug in existence. Show me the top of your handler… yep. You're parsing the JSON and re-stringifying it. Stripe signs the raw bytes. Parse and stringify reorders the whitespace and the signature can never match. Await req dot text instead." },
    { who: "c", text: "Changed to req dot text… and it STILL says four hundred. Same signature error. How? The body is raw now." },
    { who: "e", text: "Because there are two different signing secrets in play. The webhook endpoint you made in the dashboard has its own secret, but the Stripe CLI generates a fresh temporary one every time stripe listen starts — it printed it in your terminal and you used the dashboard one. Swap in the CLI secret for local testing." },
    { who: "c", text: "There it is — two hundred! And the subscriptions row appeared. Tier pro, status trialing, period end May fifth. That trialing status is the seven-day trial. This feels REAL now. People can actually pay me." },
    { who: "e", text: "Two more pieces before we wrap. Handle customer dot subscription dot updated so renewals and cancellations sync — upsert by subscription id. And enable the hosted customer portal so you never hand-build a cancel flow. It's a checkbox in billing settings plus one redirect route." },
    { who: "c", text: "Portal is on. And I added the server-side free-tier cap — fourth meal plan in a month returns a four oh two unless there's an active or trialing subscription. The UI check alone wasn't enforcement, got it. Uploading my webhook debug log for the record." },
    { who: "e", text: "Good habit. Next week is performance week — bring the production URL and we'll run Lighthouse live before touching anything. My bet is your four point eight megabyte hero image is half the problem on its own." },
  ],
  files: [
    {
      name: "stripe-webhook-debug.txt",
      mime: "text/plain",
      kind: "document",
      content: `PlatePal — Stripe webhook debugging log (test mode)
Date: 2026-04-28  ·  Relay session with Marcus Webb

$ stripe listen --forward-to localhost:3000/api/stripe/webhook
> Ready! Your webhook signing secret is whsec_d8f31c0a9b2e47f6a1c5 (^C to quit)

ATTEMPT 1  (handler used await req.json() + JSON.stringify)
2026-04-28 14:31:02   --> checkout.session.completed [evt_1RPpw2Kj]
2026-04-28 14:31:02   <-- [400] POST http://localhost:3000/api/stripe/webhook
    Webhook Error: No signatures found matching the expected signature for payload.
    Are you passing the raw request body you received from Stripe?

ATTEMPT 2  (raw body via await req.text(), but STRIPE_WEBHOOK_SECRET still
            set to the DASHBOARD endpoint secret, not the CLI one)
2026-04-28 14:39:48   --> checkout.session.completed [evt_1RPq4XKj]
2026-04-28 14:39:48   <-- [400] POST http://localhost:3000/api/stripe/webhook
    Webhook Error: No signatures found matching the expected signature for payload.

ATTEMPT 3  (raw body + CLI secret whsec_d8f31c0a9b2e47f6a1c5)
2026-04-28 14:44:15   --> checkout.session.completed [evt_1RPq8rKj]
2026-04-28 14:44:15   <-- [200] POST http://localhost:3000/api/stripe/webhook
2026-04-28 14:44:16   --> customer.subscription.created [evt_1RPq8sKj]
2026-04-28 14:44:16   <-- [200]

DB result:
  subscriptions: 1 row — tier='pro', status='trialing',
  stripe price: price_1RPplPro999 ($9.99/mo, trial_period_days=7)
  current_period_end: 2026-05-05T14:44:00Z
  test card used: 4242 4242 4242 4242

Lessons (per Marcus):
  1. Always verify against the RAW request body (await req.text()).
  2. stripe listen issues its own whsec_ — dashboard secret won't validate CLI events.
  3. Webhook = source of truth; success redirect is decoration.
`,
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Session 4 — May 6, 2026 · Performance
// ───────────────────────────────────────────────────────────────────────────
const S4: SeedSession = {
  startsAt: "2026-05-06T14:00:00Z",
  durationMinutes: 33,
  title: "Performance: Lighthouse 38 → 96, LCP 6.2s → 1.8s",
  overview:
    "Performance triage on platepal-beta.vercel.app. Baseline Lighthouse (mobile): performance 38, LCP 6.2s, CLS 0.31, JS bundle 1.9 MB. Fixes applied live: the 4.8 MB hero PNG replaced with a 210 KB WebP served through next/image with a Cloudinary loader (cloud name platepal-prod); moment.js (289 KB) swapped for date-fns; recharts lazy-loaded behind next/dynamic (it only renders on the nutrition tab); the PDF export (jspdf) moved to a dynamic import on click. Data layer: the recipes list was doing select * — narrowed to the 8 columns the card needs, added React Query with staleTime 5 minutes, and confirmed idx_recipes_user_created is used via EXPLAIN ANALYZE (seq scan → index scan, 410ms → 12ms). Result: Lighthouse 96, LCP 1.8s, CLS 0.02, bundle 740 KB.",
  nextSteps: [
    "Add explicit width/height to remaining recipe-card images to keep CLS at ~0",
    "Move OG-image generation to @vercel/og at the edge (currently a 1.1 MB static PNG)",
    "Next session: the AI meal-plan generator — quality, cost and rate limiting",
  ],
  summary:
    "Lighthouse mobile went 38 → 96. Key fixes: 4.8 MB hero PNG → 210 KB WebP via next/image + Cloudinary (platepal-prod), moment.js → date-fns, recharts + jspdf lazy-loaded (bundle 1.9 MB → 740 KB), recipes query narrowed from select * with React Query staleTime 5 min (410 ms → 12 ms via index scan). LCP 6.2 s → 1.8 s, CLS 0.31 → 0.02.",
  chat: [
    { from: "c", body: "Confession: I showed PlatePal to an investor on Friday and the landing page took 8 seconds on his phone on conference wifi. He literally said 'is it loading?'. HELP." },
    { from: "e", body: "Nothing motivates perf work like investor wifi 😄 Rule for today: measure first, fix second, measure again. Run Lighthouse in Chrome devtools, Mobile preset, on the prod URL, and give me the four headline numbers." },
    { from: "c", body: "Performance 38 😬 LCP 6.2s, CLS 0.31, TBT 890ms. 'Reduce unused JavaScript' says 1.2 MB potential savings. Total JS is 1.9 MB." },
    { from: "e", body: "Classic AI-app profile. The LCP element will be your hero image — check the report… what's the file?" },
    { from: "c", body: "hero-spread.png, 4.8 MB 🙈 It's the big photo of the meal spread on the landing page. The designer exported it at 4096px." },
    { from: "e", body: "There's two-thirds of your problem. Plan: serve it as WebP, properly sized, through next/image with a CDN loader. You already have a Cloudinary account from the recipe uploads, right? What's the cloud name?" },
    { from: "c", body: "Yes — cloud name is platepal-prod." },
    { from: "e", body: "Upload the original there and use next/image with the Cloudinary loader (f_auto,q_auto,w_auto). It'll negotiate WebP/AVIF per browser and size per viewport. The 4096px PNG becomes ~210 KB WebP at hero size. Also add priority on the hero so it preloads, and explicit width/height — that kills most of your CLS too (0.31 is the image popping in late)." },
    { from: "c", body: "Done and deployed. Lighthouse again… Performance 71! LCP 2.9s, CLS 0.06. HUGE. Now the JavaScript?" },
    { from: "e", body: "Run `npx @next/bundle-analyzer`… looking at your treemap: the three big blocks are moment.js at 289 KB (with every locale), recharts at 410 KB, and jspdf at 280 KB. Questions: where do you use each?" },
    { from: "c", body: "moment formats dates in like 4 places. recharts is the macro charts on the nutrition tab only. jspdf is the 'export meal plan as PDF' button." },
    { from: "e", body: "All three are fixable in 30 minutes:\n1. moment → date-fns (imports are tree-shaken, you'll ship ~8 KB for 4 functions)\n2. recharts → `next/dynamic(() => import('./MacroCharts'), { ssr: false })` — only loads when the nutrition tab mounts\n3. jspdf → dynamic `await import('jspdf')` inside the click handler — nobody pays for the PDF library until they click export" },
    { from: "c", body: "All three done. Bundle is now 740 KB (was 1.9 MB). Lighthouse: 89! LCP 2.1s. One more push?" },
    { from: "e", body: "Data layer. Open the Network tab, load the dashboard — that /rest/v1/recipes call: how big and how slow?" },
    { from: "c", body: "312 KB, 410ms. It's select * and we have those big jsonb ingredients/steps columns from the migration…" },
    { from: "e", body: "Exactly — the recipe CARDS only need 8 columns: id, title, cuisine, kcal, protein_g, carbs_g, fat_g, prep_minutes. Select those. The full row loads on the detail page only. And wrap the list in React Query with staleTime: 5 * 60 * 1000 so tab-switching doesn't refetch." },
    { from: "c", body: "Narrowed + React Query added. The call is now 38 KB / 95ms. And EXPLAIN ANALYZE in the Supabase SQL editor shows 'Index Scan using idx_recipes_user_created' — your index from session 2 finally earning its keep. Was 'Seq Scan' before with 410ms." },
    { from: "e", body: "Love it when the layers connect. Final Lighthouse?" },
    { from: "c", body: "Performance 96. LCP 1.8s. CLS 0.02. TBT 140ms. From 38 this morning. Sending the investor the link again with zero shame 😎" },
    { from: "e", body: "Recap for the record: hero 4.8 MB PNG → 210 KB WebP via Cloudinary loader; moment.js → date-fns; recharts + jspdf lazy; select * → 8 columns + React Query 5-min staleTime; index scan confirmed. Remaining (non-urgent): width/height on recipe-card imgs, and that 1.1 MB static OG image should be @vercel/og at the edge." },
    { from: "c", body: "Booked for next Tuesday — the BIG one. The AI meal-plan generator is my core feature and it's flaky: sometimes invalid JSON, sometimes it ignores allergies, and I have NO idea what it costs me per user. See you then!" },
  ],
  captions: [
    { who: "c", text: "So picture this. Friday. Investor meeting. He opens the app on his phone, conference wifi, and we just… stare at a white screen for eight seconds. He asks 'is it loading?'. I wanted to disappear. Fix me, Marcus." },
    { who: "e", text: "We'll fix the app, you're fine. Ground rule for performance work: measure, fix, measure. No vibes. Run Lighthouse on the production URL with the mobile preset and read me performance, LCP, CLS, and total blocking time." },
    { who: "c", text: "Performance thirty-eight. LCP six point two seconds. CLS zero point three one. Blocking time eight ninety. And it says one point two megabytes of unused JavaScript. The total bundle is one point nine megs." },
    { who: "e", text: "The LCP element is your hero image — hero spread dot png, four point eight megabytes at four thousand ninety-six pixels wide. That single file is most of your six seconds. We're going to serve it through next image with your Cloudinary account, platepal prod, with automatic format and quality." },
    { who: "c", text: "Deployed. Running Lighthouse again… seventy-one! LCP two point nine. And the layout doesn't jump anymore because of the explicit width and height — CLS went from point three one to point zero six. One image. Unbelievable." },
    { who: "e", text: "Now the JavaScript. Your bundle treemap shows three boulders: moment js at two eighty-nine K with every locale bundled, recharts at four ten K, and js pdf at two eighty K. Moment becomes date fns — tree shaken, you ship about eight K. The other two get lazy loaded — recharts only when the nutrition tab mounts, js pdf only inside the export click handler." },
    { who: "c", text: "All three swapped. Bundle is seven forty K now, down from one point nine megs. Lighthouse eighty-nine. You said there was one more layer — the data fetching?" },
    { who: "e", text: "The recipes call is select star, three hundred twelve K and four hundred ten milliseconds, dragging those big jsonb ingredients and steps columns into a list view that renders eight fields. Select just the eight columns the card needs, add React Query with a five-minute stale time, and let's verify the index from our schema session actually gets used." },
    { who: "c", text: "Explain analyze says index scan using idx recipes user created — twelve milliseconds. It was a sequential scan at four hundred ten before. And the payload is thirty-eight K. The dashboard feels instant now, like genuinely native-app instant." },
    { who: "e", text: "Final numbers for the record: Lighthouse ninety-six, LCP one point eight, CLS zero point zero two, blocking time one forty. From thirty-eight this morning. Send your investor the link again. Next week we tackle the AI generator — bring examples of the bad outputs you mentioned, especially any case where it ignored an allergy. That one matters more than cost." },
  ],
  files: [],
};

// ───────────────────────────────────────────────────────────────────────────
// Session 5 — May 13, 2026 · AI meal-plan generator
// ───────────────────────────────────────────────────────────────────────────
const S5: SeedSession = {
  startsAt: "2026-05-13T14:00:00Z",
  durationMinutes: 56,
  title: "AI meal-plan generator: prompt v3, JSON mode, safety and cost",
  overview:
    "Rebuilt PlatePal's core AI feature. Model locked to gpt-4o-mini with temperature 0.7, max_tokens 1200, response_format json_object, validated with a zod schema (weekPlanSchema) — on validation failure it retries up to 2 times at temperature 0.4. The system prompt was rewritten as versioned 'v3' (stored in prompt-templates.txt): hard rules section puts allergies as inviolable constraints (the old prompt listed them after the preferences, and the model ignored a tree-nut allergy in one tester's plan — the most serious bug found in the app), plus kosher/halal handled as diet_type filters with explicit ingredient exclusion lists. Cost analysis: a 7-day plan generation averages 2,900 prompt + 1,050 completion tokens ≈ $0.0042 per plan; projected at 1,000 active users ≈ $58/month. Abuse control: Pro is unlimited per-user but globally rate-limited at 20 generations/min via an Upstash Redis sliding window; Free stays at 3 plans/month enforced in Postgres.",
  nextSteps: [
    "Add an automated eval set: 25 dietary-profile fixtures asserted against generated plans in CI (allergy violations must be 0)",
    "Log every generation's token usage to a generations table for real cost telemetry",
    "Next session: go-live plan — domain, analytics, email, legal pages, and the GoLive quote",
  ],
  summary:
    "Hardened the AI generator: gpt-4o-mini, temp 0.7, max_tokens 1200, JSON mode + zod validation with 2 retries at temp 0.4. Prompt v3 makes allergies inviolable hard rules (fixed a real tree-nut violation), kosher/halal as exclusion-list filters. Cost ≈ $0.0042/plan (~$58/mo at 1k users). Rate limiting: Upstash Redis sliding window, 20 generations/min global.",
  chat: [
    { from: "c", body: "Big one today. The meal-plan generator is why people sign up and it's my biggest source of bug reports. Three problems: (1) sometimes the response isn't valid JSON and the UI just spins forever, (2) one tester with a tree-nut allergy got almond-crusted salmon on Thursday — she was rightfully furious, (3) I genuinely don't know if this feature is costing me $5 or $500 a month." },
    { from: "e", body: "Problem 2 is the one that can end the company, so we'll do safety → reliability → cost. First show me the current prompt and the API call." },
    { from: "c", body: "Pasting the call: model gpt-4o-mini, temperature 1.0, no max_tokens, no response_format. The prompt is one paragraph that says 'create a 7 day meal plan for a user who likes {cuisines}, is {diet_type}, wants {calorie_target} calories, has allergies: {allergies}'." },
    { from: "e", body: "There's the tree-nut bug: allergies are mentioned LAST, as a preference among preferences, at temperature 1.0. LLMs weight instruction position and framing — safety constraints must be structurally separate from preferences and stated as inviolable. Here's the v3 prompt structure:\n\n```\nROLE: You generate weekly meal plans as JSON.\n\nHARD RULES (must never be violated):\n1. NEVER include any ingredient containing: {allergies}. This includes derivatives (almond flour, peanut oil, …).\n2. Diet type {diet_type} excludes: {exclusion_list}.\n3. Output MUST match the JSON schema exactly. No prose.\n\nPREFERENCES (best effort): cuisines {cuisines}, calorie target {calorie_target}±10%, max prep {max_prep} min on weekdays.\n```\n\nNote allergies are rule #1, before everything." },
    { from: "c", body: "The exclusion lists — that's for kosher/halal?" },
    { from: "e", body: "Yes. Don't make the model reason about religious dietary law from scratch — give it the list. diet_type 'halal' → exclude pork, gelatin (non-certified), alcohol in cooking, etc.; 'kosher' → pork, shellfish, mixing meat+dairy in one recipe. Deterministic exclusion lists in YOUR code, injected into the prompt. The model fills in creativity, not law." },
    { from: "c", body: "That's such a clean separation. Okay — the invalid JSON spinner of death?" },
    { from: "e", body: "Three layers:\n1. `response_format: { type: \"json_object\" }` — JSON mode, the model can't emit prose\n2. Validate with zod — define weekPlanSchema: 7 days × 4 slots, each entry {title, ingredients[], kcal, protein_g, carbs_g, fat_g}\n3. On zod failure: retry up to 2 times with temperature dropped to 0.4 and the validation error appended to the prompt. If all 3 attempts fail, show a real error + 'try again' button. No infinite spinners." },
    { from: "c", body: "Also setting temperature 0.7 for the first attempt like we discussed, and max_tokens 1200 — the plans I measured come back around 1,000-1,100 tokens." },
    { from: "e", body: "Good measurements. Now cost — let's compute it properly. Your prompt with a full dietary profile + pantry context averages ~2,900 input tokens, completions ~1,050. gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output. Per plan: (2900×0.15 + 1050×0.60)/1,000,000 ≈ $0.0042. Worst case with both retries ≈ $0.0126." },
    { from: "c", body: "So if I somehow hit 1,000 active users each generating ~3 plans + regenerations a month… that's like $13-15/month?? I was budgeting $500." },
    { from: "e", body: "With your real regeneration ratio (testers average ~9 generations/month — people tweak a lot) it's closer to $58/month at 1,000 users. Still: AI cost is NOT your problem at this stage. Abuse is — someone scripting your endpoint burns real money. Hence rate limiting." },
    { from: "c", body: "Upstash Redis like you mentioned in chat earlier?" },
    { from: "e", body: "Yes — free tier covers you. Sliding-window limiter, 20 generations/min GLOBAL (not per user — this is your cost circuit-breaker), plus the per-user Free cap of 3 plans/month you already enforce in Postgres. Code:\n\n```ts\nimport { Ratelimit } from \"@upstash/ratelimit\";\nimport { Redis } from \"@upstash/redis\";\n\nconst limiter = new Ratelimit({\n  redis: Redis.fromEnv(),\n  limiter: Ratelimit.slidingWindow(20, \"1 m\"),\n  prefix: \"platepal:gen\",\n});\n```" },
    { from: "c", body: "In and deployed. I ran 25 test generations against the new pipeline — every one valid JSON on the first try except one, which passed on retry #1 at temp 0.4. And I tried to reproduce the tree-nut bug with 10 adversarial profiles: zero violations. The almond-crusted salmon is dead." },
    { from: "e", body: "Don't trust 10 manual runs forever — make it an eval. 25 fixture profiles in CI, assert zero allergy violations and schema validity on every deploy. That's your regression net for prompt changes. Action item #1." },
    { from: "c", body: "Added to the list. I'm attaching the final v3 prompt template + the few-shot example we wrote so it's on the project record.", attach: "prompt-templates.txt" },
    { from: "e", body: "Saved. This was a great session — the feature went from 'demo that sometimes works' to 'production system with a safety contract'. Next Tuesday: GO-LIVE planning. Domain, analytics, email, legal pages — and if you want Relay to handle the production cutover as a fixed project, request a GoLive quote in the app and I'll put together a proper bid." },
    { from: "c", body: "Doing that right now. The launch target in my head is mid-June — there's a FoodTech Weekly newsletter feature slot I might get on June 15. See you Tuesday!" },
  ],
  captions: [
    { who: "c", text: "Today is the heart of the app. The generator. Three problems, in order of how much sleep I lose: a tester with a tree-nut allergy got served almond-crusted salmon. Sometimes the JSON comes back broken and my UI spins forever. And I have zero idea what this costs me per month." },
    { who: "e", text: "The allergy one is the existential one so we start there. Show me the prompt… okay, see how allergies are the last item in a single paragraph, framed exactly like the cuisine preferences? At temperature one, the model treats it as one preference among many. Safety constraints have to be structurally separate and inviolable." },
    { who: "c", text: "So prompt v3 has a hard rules block at the very top — never include ingredients containing the allergens, including derivatives like almond flour and peanut oil — and then preferences as a separate best-effort section below. The position and the framing both matter." },
    { who: "e", text: "Exactly. And for kosher and halal we don't ask the model to reason about religious law — your code owns deterministic exclusion lists per diet type and injects them. Halal excludes pork, non-certified gelatin, cooking alcohol. Kosher excludes pork, shellfish, and meat-plus-dairy in a single recipe. The model gets creativity, not jurisdiction." },
    { who: "c", text: "Moving to reliability — I've turned on JSON mode with response format json object, and I wrote the zod schema, week plan schema — seven days, four slots, each entry needs title, ingredients, and the four macros. What happens when validation still fails?" },
    { who: "e", text: "Retry, maximum twice, with temperature dropped from point seven to point four and the zod error message appended so the model knows what it got wrong. If all three attempts fail you show an honest error with a try-again button. An infinite spinner is the worst possible UX because it lies." },
    { who: "c", text: "Now the money question. Walk me through the math because I budgeted five hundred dollars a month for OpenAI and I'm scared to look at the dashboard." },
    { who: "e", text: "Your average generation is about twenty-nine hundred input tokens and ten fifty output. At GPT four oh mini pricing that's zero point four two cents per plan. Four tenths of a cent. At a thousand active users with your real regeneration behavior, roughly fifty-eight dollars a month. Your five hundred dollar budget was off by an order of magnitude in the good direction." },
    { who: "c", text: "Half a cent per plan. Incredible. So the real risk isn't my users, it's someone scripting the endpoint and running up volume. That's what the Upstash rate limiter is for — twenty generations a minute globally as a circuit breaker, on top of the per-user free cap in Postgres." },
    { who: "e", text: "Right. And I ran your twenty-five test profiles while we talked — twenty-four valid on first attempt, one passed on the first retry, and zero allergy violations across the ten adversarial profiles including the tree-nut one. The bug that made your tester furious is structurally gone." },
    { who: "c", text: "I'm putting the v3 template and the few-shot example into a text file on the project record. And before next week I'll request the go-live quote in the app — I want Relay to run the production cutover properly. There's a newsletter feature slot on June fifteenth I'm aiming for." },
    { who: "e", text: "Request it and I'll have a one-page bid ready by Thursday: fixed scope, fixed price, timeline working back from your June fifteenth date. Next session we plan the whole launch — domain, analytics, email, legal. Bring opinions about analytics tools, I have a strong one about not using Google Analytics for a product like yours." },
  ],
  files: [
    {
      name: "prompt-templates.txt",
      mime: "text/plain",
      kind: "document",
      content: `PlatePal — AI meal-plan generation prompt (PROMPT VERSION v3)
Locked on Relay session 2026-05-13 (Rohan Mehta + Marcus Webb)
Model: gpt-4o-mini · temperature 0.7 (retries at 0.4, max 2) · max_tokens 1200
response_format: { "type": "json_object" } · validated with zod weekPlanSchema

──────────────────────────── SYSTEM PROMPT (v3) ────────────────────────────
ROLE: You generate weekly meal plans as JSON for the PlatePal app.

HARD RULES (must never be violated, in priority order):
1. NEVER include any ingredient containing the user's allergens: {{allergies}}.
   This includes derivatives and hidden forms (almond flour, peanut oil,
   whey, casein, soy lecithin, sesame tahini, etc.).
2. Diet type "{{diet_type}}" strictly excludes: {{exclusion_list}}.
   (Exclusion lists are provided by the application, e.g.
    halal -> pork, non-certified gelatin, alcohol used in cooking;
    kosher -> pork, shellfish, meat and dairy combined in one recipe;
    vegan -> all animal products including honey.)
3. Output MUST be a single JSON object matching the provided schema.
   No markdown, no prose, no comments.

PREFERENCES (best effort, may be traded off):
- Preferred cuisines: {{cuisines}}
- Daily calorie target: {{calorie_target}} kcal (±10%)
- Max weekday prep time: {{max_prep_minutes}} minutes
- Use pantry items where possible: {{pantry_summary}}

OUTPUT SCHEMA (informal):
{ "days": [ { "day": 0-6, "meals": { "breakfast"|"lunch"|"dinner"|"snack":
  { "title": string, "ingredients": [{"slug": string, "qty": number,
    "unit": string}], "kcal": number, "protein_g": number,
    "carbs_g": number, "fat_g": number, "prep_minutes": number } } } ] }

────────────────────────── FEW-SHOT EXAMPLE (1 day) ─────────────────────────
USER PROFILE: vegetarian, 2000 kcal, allergies: [tree nuts], cuisines: [italian]
ASSISTANT (excerpt):
{"days":[{"day":0,"meals":{"breakfast":{"title":"Ricotta & berry toast",
"ingredients":[{"slug":"sourdough","qty":2,"unit":"slice"},
{"slug":"ricotta","qty":80,"unit":"g"},{"slug":"blueberries","qty":60,"unit":"g"}],
"kcal":420,"protein_g":18,"carbs_g":52,"fat_g":14,"prep_minutes":8}, ... }}]}

──────────────────────────── COST REFERENCE ────────────────────────────────
Avg generation: ~2,900 prompt tokens + ~1,050 completion tokens
gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
=> ~$0.0042 per plan ($0.0126 worst case with 2 retries)
=> ~$58 / month projected at 1,000 active users (real regen behavior ~9/mo)

Rate limiting: Upstash Redis sliding window, 20 generations/min GLOBAL
(prefix "platepal:gen") + Free tier cap 3 plans/month enforced in Postgres.

History: v1 = single paragraph (allergies ignored once — tree-nut incident
2026-05-09, almond-crusted salmon served to allergic tester); v2 = added JSON
mode; v3 = hard-rules restructure + exclusion lists + retry-at-0.4 (current).
`,
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Session 6 — May 21, 2026 · Go-live planning + GoLive quote
// ───────────────────────────────────────────────────────────────────────────
const S6: SeedSession = {
  startsAt: "2026-05-21T14:00:00Z",
  durationMinutes: 41,
  title: "Go-live plan: platepal.app, analytics, email — and the GoLive bid",
  overview:
    "Launch-planning session working back from the June 15 FoodTech Weekly feature. Domain: platepal.app bought via Cloudflare Registrar at $14.20/yr, DNS proxied to Vercel, SSL automatic. Analytics: chose Plausible ($9/mo) over GA4 — cookieless, no consent banner needed for it, one-line script. Transactional email: Resend ($20/mo) with two templates for launch — welcome email and weekly plan-ready digest — on a verified platepal.app domain (SPF + DKIM walked through live). Error tracking: Sentry team plan ($26/mo), source maps uploaded on Vercel build. Legal: privacy policy + terms generated and reviewed, GDPR-safe analytics noted explicitly. Monthly run-rate after launch totals ≈ $158/mo (sheet in Launch_Budget.xlsx). Rohan formally requested the GoLive quote in-app; Marcus submitted a fixed bid of €4,800 — scope: production Supabase project + migration, domain/DNS/SSL cutover, monitoring + alerting, load test to 500 concurrent, launch-day on-call, 1-week post-launch support. Timeline 3 weeks, cutover June 11, validity 14 days. Rohan accepted and committed the same day.",
  nextSteps: [
    "Rohan to point platepal.app nameservers at Cloudflare and verify domain in Resend (SPF + DKIM records)",
    "Marcus to start the GoLive engagement Monday May 25: staging environment first, then production project",
    "Lock launch comms: FoodTech Weekly feature confirmed for June 15 issue",
  ],
  summary:
    "Planned the full launch stack: platepal.app ($14.20/yr Cloudflare), Plausible analytics ($9/mo, cookieless), Resend email ($20/mo, welcome + weekly digest), Sentry ($26/mo). Run-rate ≈ $158/mo (Launch_Budget.xlsx). GoLive quote requested and bid submitted: €4,800 fixed, 3 weeks, production cutover June 11 — accepted and committed by the customer.",
  chat: [
    { from: "c", body: "NEWS: FoodTech Weekly confirmed they're featuring PlatePal in the June 15 issue. That's my launch date now. 25 days. What do we need?" },
    { from: "e", body: "Congrats!! 🎉 That's a real deadline, so let's work backwards from June 15. Launch checklist has 6 lanes: domain, analytics, email, error tracking, legal, and the production infrastructure itself. Let's bang through the first five today and then talk about how you want to handle the infra cutover." },
    { from: "c", body: "Domain first — I want platepal.app. Checked, it's available." },
    { from: "e", body: "Buy it through Cloudflare Registrar — at-cost pricing, .app is $14.20/yr there (GoDaddy wants $24.99 + upsells). Bonus: .app domains are on the HSTS preload list, HTTPS is mandatory and automatic. Point DNS at Vercel with the CNAME they give you, leave the Cloudflare proxy on." },
    { from: "c", body: "Bought — platepal.app, $14.20, mine. Adding to Vercel domains now… verified, SSL issued. That was painless. Analytics next: GA4?" },
    { from: "e", body: "Strong no from me for your case. GA4 needs a cookie-consent banner in the EU, which costs you conversion on every visit, and you'd use 5% of its features. Plausible: $9/month, cookieless so no banner needed for it, one script tag, and the dashboard is actually readable. You care about: visitors, signups, plan-generation conversions. That's all there." },
    { from: "c", body: "Sold — Plausible it is, account created, script added with a custom event for 'signup' and 'plan_generated'. Email — right now ALL my email goes through Supabase's built-in sender and people say it lands in spam." },
    { from: "e", body: "Because Supabase's shared sender is for development. For launch: Resend, $20/month tier. Verify the platepal.app domain — you'll add 3 DNS records, I'll walk you through SPF and DKIM now since you have Cloudflare open anyway. Then two templates minimum for launch: the welcome email and the weekly 'your plan is ready' digest." },
    { from: "c", body: "DNS records added… Resend says 'verified' ✅. Wired the welcome email through their SDK. The digest needs a cron — Vercel cron on Sunday 17:00 UTC hitting an /api/cron/digest route?" },
    { from: "e", body: "Exactly right, and protect the route with a CRON_SECRET header check. Error tracking next: Sentry, team plan $26/month. Install @sentry/nextjs, the wizard does source-map upload on Vercel builds automatically. Set tracesSampleRate to 0.1 — full tracing on every request is overkill and costs you quota." },
    { from: "c", body: "Sentry in. It already caught a real error from my session — a TypeError in the pantry editor when quantity is blank. Filed it. Legal pages?" },
    { from: "e", body: "Privacy policy + terms. For your stack the key disclosures: you store dietary/health-adjacent data (allergies!), you send data to OpenAI for plan generation, payments via Stripe, analytics is cookieless Plausible (which makes the cookie section short). I'll send you a reviewed template pair — have a lawyer skim before you take EU paid users at scale, but this is a solid launch baseline." },
    { from: "c", body: "Received both, deployed at /privacy and /terms. Okay — the big lane. Production infrastructure. I requested the GoLive quote in the app yesterday like we discussed. What happens now?" },
    { from: "e", body: "I've got it in my queue, and here's the formal bid — also visible in your project's Quotation tab:\n\n**Scope:** dedicated production Supabase project (separate from beta) with the full schema migration; platepal.app cutover with zero-downtime DNS switch; monitoring + alerting (Sentry alerts → your email, uptime checks on / and /api/health); load test to 500 concurrent users with k6; launch-day on-call (me, June 15); 1 week post-launch support.\n**Price:** €4,800 fixed.\n**Timeline:** 3 weeks — start Monday May 25, production cutover June 11, four days of buffer before your feature.\n**Validity:** 14 days." },
    { from: "c", body: "That's genuinely less than I feared and the June 11 cutover with buffer before the 15th is exactly the plan I wanted. ACCEPTED. Committing in the app now — payment done ✅. Calendar says you start Monday." },
    { from: "e", body: "Confirmed on my side too — status flipped to committed. I'll set up staging first (a full prod-shaped environment), then the production project, and you'll get a runbook for the cutover night. One persuasion attempt before we wrap: the budget sheet. I put every recurring cost we chose today into a spreadsheet so you know your run-rate before revenue.", attach: "Launch_Budget.xlsx" },
    { from: "c", body: "$158.20/month all-in at launch scale, with the line items. My old spreadsheet had '$500??' written in a cell, so this is a relief. Last thing — should I prep anything for the FoodTech feature itself?" },
    { from: "e", body: "Three things: a press-kit page at /press (logo, screenshots, one-paragraph blurb), make sure the landing page hero says what the product does in one sentence (it currently leads with the brand name), and warm up the Resend domain by sending the digest to your beta list this Sunday and next — a domain that suddenly sends 5,000 emails on June 15 looks like spam." },
    { from: "c", body: "All three on the list. Next session is post-cutover then — let's book June 1 to check launch readiness, and I'll see your staging environment before that. 25 days to launch! 🚀" },
  ],
  captions: [
    { who: "c", text: "Okay before anything else — FoodTech Weekly said yes. PlatePal is in the June fifteenth issue. Which means I have a real launch date and twenty-five days. Tell me everything we need." },
    { who: "e", text: "That's brilliant news. Six lanes to a launch: domain, analytics, email, error tracking, legal, and production infrastructure. The first five we can do together right now on this call. The infra cutover is bigger — that's the go-live quote conversation at the end." },
    { who: "c", text: "Domain. I want platepal dot app and it's available. Where do I buy it — GoDaddy had it for about twenty-five dollars?" },
    { who: "e", text: "Cloudflare Registrar — at-cost pricing, fourteen twenty a year for dot app, no upsells. And dot app domains are HSTS preloaded so HTTPS is enforced from the first request, which is free security. Point the DNS at Vercel and you're done in five minutes." },
    { who: "c", text: "Bought and verified, SSL issued. Now you said in chat you have a strong opinion on analytics — go on, why not Google Analytics? Everyone uses Google Analytics." },
    { who: "e", text: "GA4 requires a cookie consent banner in Europe which taxes every single visit's conversion, the interface needs a training course, and you'd use five percent of it. Plausible is nine dollars a month, cookieless, one script tag. You track visitors, signups, and plan generations. Done. Boring tools for solved problems." },
    { who: "e", text: "Email is the one users will actually feel. Supabase's shared sender is why you're landing in spam. Resend at twenty a month, verify your new domain — we'll add the SPF and DKIM records together now since your Cloudflare tab is open — and your welcome email starts landing in the inbox where it belongs." },
    { who: "c", text: "Records added and verified. Welcome email is wired through their SDK, and the Sunday digest will be a Vercel cron at seventeen hundred UTC with a secret header. Sentry is installed too — twenty-six a month — and it already caught a real type error in the pantry editor. This stack is assembling fast." },
    { who: "e", text: "Now the big lane. You requested the go-live quote in the app yesterday. Here's my bid, and it's also in your quotation tab: forty-eight hundred euros fixed. Dedicated production Supabase project with the migration, zero-downtime DNS cutover, monitoring and alerting, a load test to five hundred concurrent users, me on call on launch day, and a week of post-launch support. Three weeks, cutover June eleventh, four days of buffer before your feature runs." },
    { who: "c", text: "June eleventh with buffer before the fifteenth is exactly what I needed to hear. I'm accepting right now… committed, paid, done. You start Monday. Honestly, having a fixed price and a date beats every agency conversation I've ever had." },
    { who: "e", text: "Then the last artifact today is the budget sheet — every recurring cost we just chose, in one spreadsheet. Domain, Vercel Pro, Supabase Pro, Plausible, Resend, Sentry, projected OpenAI. One fifty-eight twenty a month all-in at launch scale. You'll know your burn before your first paid cohort lands." },
    { who: "c", text: "Uploading my press-kit tasks to the list too — the slash press page, the one-sentence hero, and warming up the email domain with the beta digest these next two Sundays. Booking June first for the launch-readiness check. Twenty-five days. Let's go." },
  ],
  files: [
    {
      name: "Launch_Budget.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "document",
      sheets: {
        Monthly_Costs: [
          ["item", "provider", "plan", "usd_per_month", "notes"],
          ["Hosting", "Vercel", "Pro", 20, "needed for cron + analytics + team seat"],
          ["Database/Auth", "Supabase", "Pro", 25, "production project (separate from beta)"],
          ["Analytics", "Plausible", "Growth 10k", 9, "cookieless — no consent banner required"],
          ["Transactional email", "Resend", "Pro", 20, "welcome + weekly digest, platepal.app verified"],
          ["Error tracking", "Sentry", "Team", 26, "tracesSampleRate 0.1, source maps on build"],
          ["Image CDN", "Cloudinary", "Free tier", 0, "cloud name: platepal-prod, ~14GB/mo bandwidth OK"],
          ["AI generation", "OpenAI", "gpt-4o-mini", 58, "projected at 1,000 active users (~$0.0042/plan)"],
          ["Domain (amortized)", "Cloudflare Registrar", "platepal.app", 1.2, "$14.20/yr at-cost"],
          ["TOTAL", "", "", 159.2, "≈ $158–160/mo run-rate at launch scale"],
        ],
        OneOff_Costs: [
          ["item", "amount", "currency", "notes"],
          ["Relay GoLive engagement (Marcus Webb)", 4800, "EUR", "fixed bid — accepted & committed 2026-05-21; cutover 2026-06-11"],
          ["Logo refresh (Fiverr)", 120, "USD", "press kit"],
          ["LLC formation + registered agent (year 1)", 310, "USD", "already paid in March"],
        ],
        Launch_Checklist: [
          ["lane", "task", "owner", "status"],
          ["Domain", "Buy platepal.app via Cloudflare ($14.20/yr)", "Rohan", "done 2026-05-21"],
          ["Domain", "DNS → Vercel, SSL", "Rohan", "done 2026-05-21"],
          ["Analytics", "Plausible + signup / plan_generated events", "Rohan", "done 2026-05-21"],
          ["Email", "Resend domain verify (SPF+DKIM)", "Rohan", "done 2026-05-21"],
          ["Email", "Weekly digest cron (Sun 17:00 UTC, CRON_SECRET)", "Rohan", "done 2026-05-21"],
          ["Errors", "Sentry team plan, sample rate 0.1", "Rohan", "done 2026-05-21"],
          ["Legal", "/privacy + /terms deployed", "Rohan", "done 2026-05-21"],
          ["Infra", "Staging environment", "Marcus (Relay)", "starts 2026-05-25"],
          ["Infra", "Production Supabase + migration", "Marcus (Relay)", "wk of 2026-06-01"],
          ["Infra", "Load test 500 concurrent (k6)", "Marcus (Relay)", "by 2026-06-09"],
          ["Infra", "Production cutover", "Marcus (Relay)", "2026-06-11"],
          ["Comms", "FoodTech Weekly feature", "Rohan", "2026-06-15"],
          ["Comms", "/press page + 1-sentence hero", "Rohan", "by 2026-06-08"],
        ],
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Session 7 — May 29, 2026 · Post-launch triage + maintenance retainer
// ───────────────────────────────────────────────────────────────────────────
const S7: SeedSession = {
  startsAt: "2026-05-29T14:00:00Z",
  durationMinutes: 36,
  title: "Soft-launch triage: timezone bug, duplicate shopping items, retainer",
  overview:
    "PlatePal soft-launched on May 26 (cutover to the production environment landed early — staging had gone so smoothly that Marcus moved the cutover up from June 11 to May 26 to bank real-traffic time before the FoodTech feature). First 4 days: 142 signups, 19 Pro trials started, 3 paid conversions, Sentry showing 11 distinct issues of which 2 critical — both fixed this session. Bug 1 (critical): users in UTC+5:30 (Asia/Kolkata) saw Monday's meals on Sunday evening — root cause: day-of-week computed server-side with UTC getDay(); fix: store IANA timezone in dietary_profiles.user_timezone and compute with date-fns-tz. Bug 2 (critical): regenerating a meal plan duplicated shopping-list items; fix: replace blind inserts with an upsert on a new unique constraint (user_id, meal_plan_id, ingredient_slug). Also reviewed week-1 metrics (38% of signups generated ≥2 plans; digest open rate 61%) and discussed the post-launch relationship: Rohan requested a Maintain/Enhance quote; Marcus bid €650/month retainer (10 hrs/mo, 48h priority bugfix SLA, weekly dependency updates, monthly performance review) — status: quoted, Rohan reviewing until after the June 15 feature. Roadmap sketched: React Native mobile app discovery in Q3, pantry barcode scanner spike (likely on-device via expo-camera + Open Food Facts API).",
  nextSteps: [
    "Rohan to decide on the €650/mo maintenance retainer after the June 15 FoodTech feature lands",
    "Backfill user_timezone for the 142 existing users from their browser tz on next login",
    "Marcus to write the barcode-scanner spike notes (expo-camera + Open Food Facts) for the Q3 mobile discovery",
  ],
  summary:
    "Post-soft-launch (May 26) triage: 142 signups / 19 trials / 3 paid in 4 days. Fixed both critical Sentry issues: the UTC+5:30 timezone bug (UTC getDay() → date-fns-tz + dietary_profiles.user_timezone) and duplicate shopping-list items on plan regeneration (upsert on user_id, meal_plan_id, ingredient_slug). Maintain/Enhance quote submitted: €650/mo retainer, 10 hrs + 48h SLA — pending customer decision after June 15.",
  chat: [
    { from: "c", body: "WE'RE LIVE. Well — soft-live. Since you moved the cutover up to May 26, real users have been on production for 4 days: 142 signups, 19 Pro trials, 3 actual paying customers. But Sentry is yelling and I have two bugs that users are emailing me about." },
    { from: "e", body: "142 organic signups before the press feature is genuinely strong. Let's triage. Sentry shows 11 distinct issues — I see 2 marked critical. Read me bug #1 as users describe it?" },
    { from: "c", body: "It's WEIRD. Users in India keep saying the app shows 'Monday's meals' on Sunday evening. One wrote: 'at 7pm Sunday the app thinks it's Monday and my Sunday dinner disappeared.' Users in the US/EU never report this." },
    { from: "e", body: "India is the tell: UTC+5:30. At 18:30 UTC Sunday it's already 00:00 Monday in Kolkata — but the inverse problem: at 7pm Sunday in Kolkata it's only 13:30 UTC Sunday… so if it shows MONDAY, your server is computing day-of-week somewhere AHEAD of the user. Where do you compute 'today's meals' — client or server?" },
    { from: "c", body: "Server — the /api/today route does `new Date().getDay()` and picks the plan_entries row for that day." },
    { from: "e", body: "Found it, but wait — server UTC getDay() would be BEHIND Kolkata, not ahead. Unless… check the route: is there any +1 adjustment?" },
    { from: "c", body: "…there's a `const day = (new Date().getDay() + 1) % 7;` with a comment from Lovable: '// adjust: our week starts Monday'. So it double-shifts: their Sunday evening + the Monday-start adjustment = shows Monday." },
    { from: "e", body: "There it is — a day-numbering hack stacked on a timezone bug. Proper fix, two parts:\n1. Store the user's IANA timezone: `ALTER TABLE dietary_profiles ADD COLUMN user_timezone text NOT NULL DEFAULT 'UTC';` — capture Intl.DateTimeFormat().resolvedOptions().timeZone at login.\n2. Compute the day in THEIR zone with date-fns-tz:\n```ts\nimport { toZonedTime } from \"date-fns-tz\";\nconst local = toZonedTime(new Date(), profile.user_timezone);\nconst day = local.getDay(); // 0=Sunday, and keep 0=Sunday everywhere — kill the +1 hack\n```\nAnd map Monday-start in the UI layer only, never in data." },
    { from: "c", body: "Migration applied, route fixed, +1 hack deleted, UI maps display order. Deployed. My Kolkata tester (the angriest one 😄) confirms Sunday is Sunday again. Bug #2: when someone regenerates their meal plan, every shopping list item appears TWICE. Three regenerations = three copies." },
    { from: "e", body: "Look at the regenerate flow — I bet it inserts the new shopping list without clearing or upserting the old one." },
    { from: "c", body: "Correct: it computes plan-minus-pantry and blind-INSERTs the rows. The old rows just stay." },
    { from: "e", body: "Fix with structure, like the duplicate dinners in session 2: add `UNIQUE (user_id, meal_plan_id, ingredient_slug)` to shopping_list_items, then make the regenerate flow upsert with `onConflict: \"user_id,meal_plan_id,ingredient_slug\"` summing quantities, and delete rows for ingredient_slugs no longer in the plan. One transaction." },
    { from: "c", body: "Done — and I wrote a cleanup script that deduped 87 existing duplicate rows on prod before adding the constraint (it wouldn't apply otherwise, learned that the fun way in 5 minutes 😅). Both critical bugs dead. Remaining 9 Sentry issues are all minor — I'll pick them off this week." },
    { from: "e", body: "Great launch-week instincts. Metrics check while we're here: 38% of signups generated 2+ plans in week 1 — that's real activation, not tourist traffic. And the Sunday digest had a 61% open rate, which is exceptional (the domain warm-up paid off). Watch trial→paid after the 19 trials hit day 7 around June 2-4." },
    { from: "c", body: "Speaking of after the launch… I don't want this to be the last session and then I'm alone again. I requested the Maintain/Enhance quote in the app this morning. What does ongoing Relay support look like?" },
    { from: "e", body: "Saw it — here's my bid, it's in your Quotation tab now: **€650/month retainer**: 10 engineering hours/month, priority bugfix SLA of 48 hours, weekly dependency + security updates, and a monthly performance review (the Lighthouse + query audit we did in session 4, recurring). Unused hours roll over one month. Cancel anytime with 30 days notice." },
    { from: "c", body: "That's very reasonable. One ask: let me decide right after the FoodTech feature on June 15 — if it goes how I hope, I might want MORE than 10 hours and we should size it then." },
    { from: "e", body: "Completely fair — bid stays valid, I noted 'customer deciding after June 15 feature' on the quote. Last topic: the roadmap you mentioned in email. Mobile app?" },
    { from: "c", body: "Yes — users keep asking for it, especially for the pantry: they want to scan barcodes while unpacking groceries. iOS first probably?" },
    { from: "e", body: "Do React Native/Expo rather than Swift — you keep one team (you), reuse the Supabase layer, and expo-camera gives you barcode scanning nearly free. Pair it with the Open Food Facts API (free, 3M+ products) to resolve barcodes → ingredients. I'll write up a spike doc for a Q3 discovery. That'd fall under retainer hours or a separate scoped project, your choice when we get there." },
    { from: "c", body: "Perfect. So: I watch the trials convert, decide on the retainer June 16-ish, and we talk mobile in Q3. Marcus — from 'nobody can log in' on April 14 to 142 users and revenue in 6 weeks. Thank you. Genuinely." },
    { from: "e", body: "You did the building — I just kept the sharp edges off. Crush the feature on the 15th. I'm on call launch-week per the GoLive scope, so if anything smokes, you know where the green dot is. 🟢" },
  ],
  captions: [
    { who: "c", text: "We are LIVE. Soft launch on the twenty-sixth like you suggested when the cutover went early. Four days of real traffic: one hundred forty-two signups, nineteen pro trials, three actual paying customers. And two bugs that have users emailing me directly." },
    { who: "e", text: "Strong numbers for pre-press. Okay, Sentry triage: eleven distinct issues, two critical. Walk me through bug one the way users describe it — I saw the words 'my Sunday dinner disappeared' in one report which is poetic." },
    { who: "c", text: "All the reports are from India. At seven p.m. Sunday their app flips to Monday's meals. US and European users never see it. The today route on the server does new Date dot get day and picks that day's entries." },
    { who: "e", text: "India is UTC plus five thirty which makes it the canary for timezone bugs. But pure server UTC would lag Kolkata, not lead it… unless something is adding a day. Open the route… there — a plus-one modulo seven with a comment about weeks starting Monday. A day-numbering hack stacked on top of a timezone assumption. Two wrongs making a visible bug." },
    { who: "c", text: "So the real fix is storing each user's IANA timezone in dietary profiles — defaulting to UTC, captured from the browser at login — and computing the day in their zone with date fns tz. And the Monday-first thing becomes purely a display concern in the UI. The plus-one hack is deleted." },
    { who: "e", text: "Deployed and confirmed by your Kolkata tester. Bug two now — duplicate shopping list items on every regenerate. Same disease we cured in session two with the duplicate dinners: a flow that inserts blindly where the data model should enforce uniqueness. Add the unique constraint on user, plan, and ingredient, and upsert." },
    { who: "c", text: "And I had to dedupe eighty-seven existing duplicate rows on production before Postgres would even accept the constraint, which I learned in real time. Both criticals are dead. The other nine issues are minor and I'll clear them this week." },
    { who: "e", text: "Metrics worth celebrating: thirty-eight percent of signups generated two or more plans in week one — that's genuine activation. The digest open rate is sixty-one percent, which says the domain warm-up worked. The nineteen trials hit their day-seven decision around June second — watch that cohort like a hawk." },
    { who: "c", text: "On the ongoing question — I requested the maintain and enhance quote this morning because I don't want this rhythm to end at launch. Talk me through the retainer bid." },
    { who: "e", text: "Six hundred fifty euros a month. Ten engineering hours, forty-eight hour priority bugfix SLA, weekly dependency and security updates, and a monthly performance review like our session four audit, recurring. Unused hours roll one month. Thirty days notice to cancel. And per your ask, the bid stays open while you see how June fifteenth goes." },
    { who: "c", text: "And the roadmap after that — users keep asking for mobile, mainly to scan barcodes into the pantry while unpacking groceries. You said React Native over Swift in chat — Expo, reuse the Supabase layer, expo camera for scanning, Open Food Facts to turn barcodes into ingredients. Q3 discovery." },
    { who: "e", text: "That's the shape. I'll write the spike notes. Rohan — six weeks ago nobody could log into this thing. Today it has revenue, a production environment, monitoring, and a press feature lined up. Go enjoy the launch. I'm on call on the fifteenth per the go-live scope. The green dot is right there if you need it." },
  ],
  files: [],
};

export const SESSIONS: SeedSession[] = [S1, S2, S3, S4, S5, S6, S7];

// ───────────────────────────────────────────────────────────────────────────
// Project-level metadata
// ───────────────────────────────────────────────────────────────────────────
export const PROJECT_META = {
  ai_summary_title: "PlatePal — from broken beta to revenue in 7 sessions",
  ai_summary_overview:
    "PlatePal is Rohan Mehta's AI meal-planning web app (Next.js + Supabase + Stripe + OpenAI on Vercel), originally generated with Lovable. Relay engineer Marcus Webb took it from a production outage (magic-link login loop, Apr 14) through a full hardening arc: 7-table relational schema with RLS replacing a single JSON-blob table (1,847 rows migrated), Stripe subscriptions (Pro $9.99/mo with 7-day trial, Family $24.99/mo) with the classic raw-body webhook signature fix, a Lighthouse 38→96 performance pass (LCP 6.2s→1.8s, bundle 1.9MB→740KB), and a safety-hardened AI generator (gpt-4o-mini, prompt v3 with inviolable allergy rules after a tree-nut incident, ~$0.0042/plan). Launch was planned around a June 15 FoodTech Weekly feature: platepal.app domain, Plausible, Resend, Sentry (~$158/mo run-rate), with a committed €4,800 GoLive engagement — cutover landed early on May 26. First 4 days: 142 signups, 19 trials, 3 paid; both critical launch bugs (UTC+5:30 timezone day-shift, duplicate shopping-list items) fixed in session 7. A €650/mo maintenance retainer is quoted and pending the customer's post-feature decision.",
  summary:
    "Seven-session Relay engagement taking PlatePal (AI meal planning; Next.js/Supabase/Stripe/OpenAI) from a total login outage to a launched, monitored, revenue-generating product with a committed go-live engagement (€4,800) and a pending €650/mo maintenance retainer. Customer: Rohan Mehta (semi-technical, Lovable/Cursor/ChatGPT user). Engineer: Marcus Webb.",
  ai_next_steps: [
    "Customer decision on the €650/mo maintenance retainer after the June 15 FoodTech Weekly feature",
    "Backfill user_timezone for the 142 launch-week users",
    "Q3: React Native/Expo mobile discovery incl. pantry barcode scanner (expo-camera + Open Food Facts)",
    "Watch the 19 Pro trials' day-7 conversion around June 2–4",
  ],
};

export const INTAKE = {
  familiarity: "Semi-Technical",
  ai_tools_used: "Lovable, Cursor, ChatGPT",
  developing: "Website",
  technologies: ["Next.js", "React", "Supabase", "Tailwind CSS", "Stripe", "OpenAI API", "Vercel"],
};

export const QUOTES = [
  {
    kind: "golive",
    status: "committed",
    quote_amount_cents: 480000, // €4,800
    bid_scope:
      "Dedicated production Supabase project (separate from beta) incl. full schema migration; platepal.app zero-downtime DNS cutover; monitoring + alerting (Sentry alert routing, uptime checks on / and /api/health); k6 load test to 500 concurrent users; launch-day on-call engineer (June 15); 1 week post-launch support.",
    bid_timeline: "3 weeks — start Mon May 25, 2026; production cutover June 11, 2026 (landed early on May 26); 4 days buffer before the June 15 FoodTech Weekly feature.",
    comments:
      "Fixed-price GoLive engagement bid by Marcus Webb on the May 21 session. Cutover was subsequently pulled forward to May 26 because staging went clean — banked 2+ weeks of real-traffic soak before the press feature.",
    customer_response_note: "Accepted and paid same day (May 21). 'Fixed price and a date beats every agency conversation I've ever had.'",
    createdAt: "2026-05-20T16:30:00Z",
    respondedAt: "2026-05-21T15:10:00Z",
  },
  {
    kind: "maintain",
    status: "quoted",
    quote_amount_cents: 65000, // €650/mo
    bid_scope:
      "Monthly maintenance retainer: 10 engineering hours/month; priority bugfix SLA 48h; weekly dependency + security updates; monthly performance review (Lighthouse + query audit). Unused hours roll over one month. Cancel anytime with 30 days notice.",
    bid_timeline: "Monthly rolling retainer, can start June 16, 2026.",
    comments:
      "Bid by Marcus Webb on the May 29 session. Customer asked to decide after the June 15 FoodTech Weekly feature — may want a larger hour block if the feature converts well.",
    customer_response_note: null as string | null,
    createdAt: "2026-05-29T09:05:00Z",
    respondedAt: "2026-05-29T15:20:00Z",
  },
];
