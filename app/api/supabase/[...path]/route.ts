/*
 * Same-origin Supabase HTTP proxy.
 *
 * Every browser-side Supabase call (auth, REST, storage, functions) is
 * routed through here so the browser only ever talks to its own origin —
 * useful on networks that drop or randomly fail cross-origin requests to
 * Supabase (corporate firewalls, VPN flaps, ERR_NETWORK_CHANGED).
 *
 *   browser ──fetch──▶ /api/supabase/auth/v1/token   (same origin)
 *   our server ──fetch──▶ https://<project>.supabase.co/auth/v1/token
 *
 * Realtime is WebSocket-based and is NOT proxied here — it still goes
 * direct from the browser to Supabase. If realtime breaks on a restricted
 * network the rest of the app will keep working (queries via REST still
 * resolve through this proxy), just without live updates.
 */

import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    return NextResponse.json({ error: "supabase_url_missing" }, { status: 500 });
  }

  const { path } = await ctx.params;
  const target = new URL(`${base.replace(/\/$/, "")}/${path.join("/")}`);
  // Carry the query string through verbatim — REST filters, auth flow tokens, etc.
  req.nextUrl.searchParams.forEach((v, k) => target.searchParams.append(k, v));

  // Forward headers, but strip the hop-by-hop ones that fetch will reset.
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("accept-encoding"); // let upstream pick; we'll re-encode below

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(target.toString(), {
    method:  req.method,
    headers,
    body:    hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
    // @ts-expect-error — Node fetch accepts this even though it's not in lib.dom
    duplex: hasBody ? "half" : undefined,
  });

  // Pass response through. Drop encoding/length headers that Node fetch has
  // already resolved so the browser doesn't try to re-decode an
  // already-decoded body.
  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  respHeaders.delete("transfer-encoding");

  return new NextResponse(upstream.body, {
    status:     upstream.status,
    statusText: upstream.statusText,
    headers:    respHeaders,
  });
}

export const GET     = forward;
export const POST    = forward;
export const PUT     = forward;
export const PATCH   = forward;
export const DELETE  = forward;
export const OPTIONS = forward;
export const HEAD    = forward;
