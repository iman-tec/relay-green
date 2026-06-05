/*
 * POST /api/enterprise-request — enterprise inquiry capture.
 *
 * Persists the "Send inquiry" enterprise form (name, email, company, message,
 * + optional channel partner) into public.enterprise_requests via the service
 * role, then best-effort emails the lead via Resend (same pattern as
 * /api/contact). Honeypot + per-IP rate limit guard against bot spam.
 *
 * Called by EnterpriseCtaButton / EnterpriseCta via
 * lib/contact/submitEnterpriseRequest.ts (which falls back to mailto: on 5xx).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const COMPANY_MAX = 160;
const MESSAGE_MAX = 4000;
const MESSAGE_MIN = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-IP rate limit: 5 / 10 min (in-memory; see /api/contact for the note).
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
  return req.headers.get("x-real-ip") ?? "local";
}

function readString(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type Payload = {
  name: string;
  email: string;
  company: string;
  message: string;
  channelPartnerId: string | null;
  channelPartnerName: string; // free-text when "Other" is chosen
  website: string; // honeypot
};

async function emailLead(
  p: Payload,
  partnerName: string | null
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(
      "[enterprise-request] RESEND_API_KEY unset — lead logged:",
      JSON.stringify({ ...p, partnerName })
    );
    return;
  }
  const to = process.env.CONTACT_INBOX_EMAIL ?? "hello@relay.green";
  const from = process.env.CONTACT_FROM_EMAIL ?? "noreply@relay.green";
  const text = [
    `Name: ${p.name}`,
    `Email: ${p.email}`,
    p.company ? `Company: ${p.company}` : null,
    partnerName
      ? `Channel partner: ${partnerName}`
      : "Channel partner: (none selected)",
    "",
    "Need:",
    p.message,
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
      reply_to: p.email,
      subject: `Relay enterprise request — ${p.name}${p.company ? ` (${p.company})` : ""}`,
      text,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Resend ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
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
  const cpRaw = readString(raw.channelPartnerId, 64);
  const payload: Payload = {
    name: readString(raw.name, NAME_MAX),
    email: readString(raw.email, EMAIL_MAX).toLowerCase(),
    company: readString(raw.company, COMPANY_MAX),
    message: readString(raw.message, MESSAGE_MAX),
    channelPartnerId: UUID_RE.test(cpRaw) ? cpRaw : null,
    channelPartnerName: readString(raw.channelPartnerName, COMPANY_MAX),
    website: readString(raw.website, 200),
  };

  // Honeypot — silently accept so bots can't probe.
  if (payload.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Channel partner is required: either a picked id or a free-text name.
  const hasPartner =
    payload.channelPartnerId !== null || payload.channelPartnerName.length > 0;

  if (
    payload.name.length === 0 ||
    payload.email.length === 0 ||
    payload.message.length < MESSAGE_MIN ||
    !EMAIL_RE.test(payload.email) ||
    !hasPartner
  ) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const admin = serviceClient();
  if (!admin) {
    // No DB configured — fall back to email-only path; 500 lets the client mailto.
    console.error("[enterprise-request] service role not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  // Resolve a trusted channel-partner name from the id (ignore client-supplied
  // names). Null partner is fine — the field is optional.
  let partnerName: string | null = null;
  if (payload.channelPartnerId) {
    const { data: cp } = await admin
      .from("resellers")
      .select("name")
      .eq("id", payload.channelPartnerId)
      .maybeSingle();
    partnerName = (cp as { name?: string } | null)?.name ?? null;
    if (!partnerName) payload.channelPartnerId = null; // unknown id → fall through
  }
  // "Other" → store the free-text name the prospect typed (no id link).
  if (!partnerName && payload.channelPartnerName) {
    partnerName = payload.channelPartnerName;
  }

  const { error: insertErr } = await admin.from("enterprise_requests").insert({
    name: payload.name,
    email: payload.email,
    company: payload.company || null,
    message: payload.message,
    channel_partner_id: payload.channelPartnerId,
    channel_partner_name: partnerName,
  });
  if (insertErr) {
    console.error("[enterprise-request] insert failed:", insertErr.message);
    return NextResponse.json({ error: "persist_failed" }, { status: 500 });
  }

  // Email is best-effort — the request is already safely stored.
  try {
    await emailLead(payload, partnerName);
  } catch (err) {
    console.error("[enterprise-request] email failed (request stored):", err);
  }

  return NextResponse.json({ ok: true });
}
