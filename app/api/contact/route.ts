/*
 * POST /api/contact — marketing-site lead capture.
 *
 * Replaces the brittle "open mailto:" UX that every public form used as a
 * stop-gap. Now: real validation, honeypot check, per-IP rate limit, and
 * (when RESEND_API_KEY is set) a transactional email send via Resend. If
 * Resend isn't configured the lead still lands in the server log so an
 * operator can scoop it up, and the client gets a 200 either way.
 *
 * The forms (EnterpriseCtaButton, EnterpriseCta, PhaseCtaForm, ContactForm)
 * call this via lib/contact/submitContact.ts which falls back to mailto:
 * on a 5xx response so a backend outage doesn't kill the inquiry path.
 *
 * Rate limit is in-memory (per Node instance) — fine for low-volume
 * marketing forms on a single Vercel function instance with Fluid Compute
 * reuse. For higher-volume use, swap the rateLimit map for a Vercel KV /
 * Upstash Redis token bucket so limits hold across instances.
 */
import { NextResponse, type NextRequest } from "next/server";

// Topics accepted from the public marketing forms. Bot traffic posting
// anything else returns 400 — no enumeration leak, just a hard reject.
const TOPICS = new Set([
  "ENTERPRISE",
  "BUILD",
  "LAUNCH",
  "MAINTAIN",
  "SALES",
  "PARTNERSHIPS",
  "PRESS",
  "GENERAL",
]);

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const COMPANY_MAX = 160;
const MESSAGE_MAX = 4000;
const MESSAGE_MIN = 10;

// Liberal email regex — we accept anything plausibly an address and let
// the actual deliverability check happen at send time.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-IP rate limit: at most 5 submissions per 10 minutes from a single
// remote address. Sliding-window token bucket in a Map; entries expire
// automatically as they age past the window.
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

// Best-effort client IP. Vercel sets x-forwarded-for; in dev we fall
// back to a string constant so rate limiting still works locally.
function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "local";
}

type ContactPayload = {
  name: string;
  email: string;
  company: string;
  topic: string;
  message: string;
  marketingConsent: boolean;
  /** Honeypot field. Always present after readString() runs ("" if empty). */
  website: string;
};

function readString(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

async function sendViaResend(payload: ContactPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Fail-soft: log the lead so an operator can scoop it up by tailing
    // logs. The client still sees a 200 (the user did their part).
    console.log(
      "[contact] RESEND_API_KEY unset — lead logged, not emailed:",
      JSON.stringify(payload)
    );
    return;
  }

  const to = process.env.CONTACT_INBOX_EMAIL ?? "hello@relay.green";
  const from = process.env.CONTACT_FROM_EMAIL ?? "noreply@relay.green";

  const subject = `Relay enquiry — ${payload.topic} — ${payload.name}`;
  const text = [
    `Topic: ${payload.topic}`,
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    payload.company ? `Company: ${payload.company}` : null,
    payload.marketingConsent ? "Marketing consent: yes" : null,
    "",
    "Message:",
    payload.message,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: payload.email,
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

export async function POST(req: NextRequest) {
  // Reject obvious replay/abuse early — keep the handler cheap for bots.
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
  const payload: ContactPayload = {
    name: readString(raw.name, NAME_MAX),
    email: readString(raw.email, EMAIL_MAX).toLowerCase(),
    company: readString(raw.company, COMPANY_MAX),
    topic: readString(raw.topic, 32).toUpperCase(),
    message: readString(raw.message, MESSAGE_MAX),
    marketingConsent: raw.marketingConsent === true,
    website: readString(raw.website, 200),
  };

  // Honeypot — silently 200 so bots can't probe. The field is hidden
  // from real users via .r-honeypot CSS + aria-hidden + tabIndex=-1, so
  // anything non-empty is bot-generated.
  if (payload.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Validation. Order matters for the error message — bots looking for
  // signal get a single generic "invalid" reply.
  if (
    payload.name.length === 0 ||
    payload.email.length === 0 ||
    payload.message.length < MESSAGE_MIN ||
    !EMAIL_RE.test(payload.email) ||
    !TOPICS.has(payload.topic)
  ) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Rate limit AFTER cheap validation so we don't burn bucket space on
  // malformed bot posts.
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    await sendViaResend(payload);
  } catch (err) {
    // Even if email send fails, persist the lead in logs so it isn't
    // lost. We still return 500 so the client falls back to mailto:
    console.error(
      "[contact] send failed — lead preserved in log:",
      err,
      JSON.stringify(payload)
    );
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
