/*
 * POST /api/partner/apply — public "become a partner" application capture.
 *
 * Backs the unauthenticated /partner/apply page. Writes one
 * partner_applications row (the durable capture — this is the source of truth,
 * unlike /api/contact where the email is primary), then best-effort fires two
 * Resend emails: an internal notification to the Relay team and a branded
 * confirmation to the applicant. A Resend outage logs but never loses the
 * application — the row is already in the super-admin queue.
 *
 * Spam + abuse defence mirrors /api/contact: hidden honeypot field (silent
 * 200) + in-memory per-IP rate limit (5 / 10 min). Not flag-gated — this is
 * top-of-funnel marketing and exposes no authed data (see
 * docs/audit/partner-apply-findings.md §6).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const COMPANY_MAX = 160;
const WEBSITE_MAX = 200;
const REGION_MAX = 80;
const CLIENTS_MAX = 2000;
const OPTIONAL_MAX = 2000;
const CLIENTS_MIN = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-IP rate limit: 5 submissions / 10 min — identical to /api/contact and
// /api/enterprise-request (in-memory sliding window; fine for low-volume
// marketing forms under Fluid Compute instance reuse).
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const buckets = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (buckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX) {
    buckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  buckets.set(ip, hits);
  return false;
}

function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "local";
}

function readString(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

type ApplicationPayload = {
  contactName: string;
  workEmail: string;
  companyName: string;
  companyWebsite: string;
  countryRegion: string;
  clientsText: string;
  heardAbout: string;
  anythingElse: string;
};

// Durable capture — the application row is the source of truth, so a failure
// here is a hard error (we return 500 and the client surfaces it). RLS is
// bypassed by the service role; there is no public insert policy.
async function persistApplication(
  payload: ApplicationPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "service_unconfigured" };
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.from("partner_applications").insert({
    contact_name: payload.contactName,
    work_email: payload.workEmail,
    company_name: payload.companyName,
    company_website: payload.companyWebsite,
    country_region: payload.countryRegion,
    clients_text: payload.clientsText,
    heard_about: payload.heardAbout || null,
    anything_else: payload.anythingElse || null,
    source: "partner_apply",
  });
  if (error) {
    console.error("[partner/apply] persist failed:", error.message);
    return { ok: false, error: "persist_failed" };
  }
  return { ok: true };
}

// Best-effort Resend send. Logs and swallows on failure — the row is already
// captured, so a mail outage must not 500 the applicant.
async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL ?? "noreply@relay.green";
  if (!apiKey) {
    console.log(
      "[partner/apply] RESEND_API_KEY unset — email skipped:",
      args.subject
    );
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[partner/apply] Resend ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("[partner/apply] email send threw:", err);
  }
}

function notifyTeam(p: ApplicationPayload): Promise<void> {
  const to = process.env.PARTNER_INBOX_EMAIL ?? "partners@relay.green";
  const text = [
    "New channel-partner application:",
    "",
    `Contact:   ${p.contactName}`,
    `Email:     ${p.workEmail}`,
    `Company:   ${p.companyName}`,
    `Website:   ${p.companyWebsite}`,
    `Region:    ${p.countryRegion}`,
    "",
    "Who are your clients / what you sell today:",
    p.clientsText,
    p.heardAbout ? `\nHeard about us: ${p.heardAbout}` : "",
    p.anythingElse ? `\nAnything else: ${p.anythingElse}` : "",
    "",
    "Review + approve in the Superadmin Panel → Partner Applications.",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return sendEmail({
    to,
    subject: `Partner application — ${p.companyName} (${p.contactName})`,
    text,
    replyTo: p.workEmail,
  });
}

function confirmApplicant(p: ApplicationPayload): Promise<void> {
  const text = [
    `Hi ${p.contactName},`,
    "",
    "Thanks for applying to the Relay Channel Partner program — we've got your application for " +
      `${p.companyName}.`,
    "",
    "A human on our partnerships team reviews every application. We'll be in " +
      "touch within two business days. If you're approved, that email is also " +
      "your way in: it carries your partner sign-in invite, your reseller code, " +
      "and your 20% wholesale pool, ready to onboard your first client in two fields.",
    "",
    "In the meantime, reply to this email with anything you'd like us to know.",
    "",
    "— The Relay partnerships team",
  ].join("\n");
  return sendEmail({
    to: p.workEmail,
    subject: "We received your Relay partner application",
    text,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Honeypot — hidden from real users; non-empty → silent 200 so bots can't
  // probe (same .r-honeypot pattern as /api/contact).
  if (readString(raw.website, WEBSITE_MAX).length > 0) {
    return NextResponse.json({ ok: true });
  }

  const payload: ApplicationPayload = {
    contactName: readString(raw.contactName, NAME_MAX),
    workEmail: readString(raw.workEmail, EMAIL_MAX).toLowerCase(),
    companyName: readString(raw.companyName, COMPANY_MAX),
    companyWebsite: readString(raw.companyWebsite, WEBSITE_MAX),
    countryRegion: readString(raw.countryRegion, REGION_MAX),
    clientsText: readString(raw.clientsText, CLIENTS_MAX),
    heardAbout: readString(raw.heardAbout, OPTIONAL_MAX),
    anythingElse: readString(raw.anythingElse, OPTIONAL_MAX),
  };

  // Validation — single generic reply so bots get no signal.
  if (
    payload.contactName.length === 0 ||
    payload.workEmail.length === 0 ||
    !EMAIL_RE.test(payload.workEmail) ||
    payload.companyName.length === 0 ||
    payload.companyWebsite.length === 0 ||
    payload.countryRegion.length === 0 ||
    payload.clientsText.length < CLIENTS_MIN
  ) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Rate limit after cheap validation so malformed bot posts don't burn the
  // bucket.
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Durable capture FIRST — the row is the source of truth. If it fails, the
  // application is lost, so this is a hard 500 (client retries / surfaces it).
  const stored = await persistApplication(payload);
  if (!stored.ok) {
    return NextResponse.json({ error: stored.error }, { status: 500 });
  }

  // Notify + confirm are best-effort: the application is already queued.
  await Promise.allSettled([notifyTeam(payload), confirmApplicant(payload)]);

  return NextResponse.json({ ok: true });
}
