/*
 * Minimal Resend transactional-email send, shared across server routes.
 *
 * Same fail-soft contract as /api/contact: when RESEND_API_KEY is unset the
 * send is skipped and logged (never throws), so a missing key or a Resend
 * outage can't break the calling flow. From address defaults to
 * CONTACT_FROM_EMAIL.
 */

export async function sendResendEmail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL ?? "noreply@relay.green";
  if (!apiKey) {
    console.log("[resend] RESEND_API_KEY unset — email skipped:", args.subject);
    return { sent: false };
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
      console.error(`[resend] ${res.status}: ${body}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error("[resend] send threw:", err);
    return { sent: false };
  }
}
