/*
 * Server-side Stripe REST helper (Node runtime). We open-code the REST
 * calls (form-urlencoded) rather than pull the Stripe SDK — the few
 * surfaces that touch Stripe from Next only need a couple of endpoints.
 *
 * Edge functions in supabase/functions/ use the Stripe SDK directly; this
 * is the Next-side equivalent for app/api routes.
 */

export const STRIPE_KEY =
  process.env.STRIPE_SANDBOX_API_KEY ??
  process.env.STRIPE_LIVE_API_KEY ??
  process.env.STRIPE_SECRET_KEY ??
  "";

export async function stripeRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, string | number | undefined>
): Promise<T> {
  const url = `https://api.stripe.com/v1${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Stripe-Version": "2024-06-20",
    },
  };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) form.set(k, String(v));
    }
    init.body = form.toString();
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/x-www-form-urlencoded";
  }
  const res = await fetch(url, init);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(
      json?.error?.message ?? `Stripe ${method} ${path} failed (${res.status})`
    );
  }
  return json;
}
