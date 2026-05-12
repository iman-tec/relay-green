import { createBrowserClient } from "@supabase/ssr";

/*
 * Browser-side Supabase client.
 *
 * Every HTTP call is rewritten to go through our /api/supabase same-origin
 * proxy instead of hitting https://<project>.supabase.co directly. This
 * sidesteps networks that drop/randomly fail cross-origin requests to
 * Supabase (corporate firewalls, VPN flaps, ERR_NETWORK_CHANGED).
 *
 * Realtime (WebSocket) is left alone — it still talks to wss://<project>...
 * directly. If a restricted network blocks that, queries still work; only
 * live-update subscriptions fall back to "manual refresh."
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Relay: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local. " +
      "Restart the dev server after adding them.",
    );
  }

  const supabaseHttpPrefix = url.replace(/\/$/, "");

  // Rewrite any URL pointing at the upstream Supabase host to our same-origin
  // proxy path. Everything else is passed through unchanged so this stays a
  // drop-in over the default `fetch`. Adds a single retry for transient
  // network errors (dev-server hiccups, brief connection resets) — the next
  // attempt almost always succeeds and downstream code stops seeing
  // bare "Failed to fetch" TypeErrors.
  const proxiedFetch: typeof fetch = async (input, init) => {
    const reqUrl =
      typeof input === "string"     ? input
      : input instanceof URL        ? input.toString()
      : input instanceof Request    ? input.url
      :                               String(input);

    const doFetch = (): Promise<Response> => {
      if (!reqUrl.startsWith(supabaseHttpPrefix)) {
        return fetch(input as RequestInfo, init);
      }
      const rewritten = "/api/supabase" + reqUrl.slice(supabaseHttpPrefix.length);
      if (input instanceof Request) {
        return fetch(new Request(rewritten, input), init);
      }
      return fetch(rewritten, init);
    };

    try {
      return await doFetch();
    } catch (err) {
      // Browser fetch throws TypeError for network-level failures (DNS,
      // connection reset, abort). One retry after a short delay clears the
      // transient cases without papering over real outages — a sustained
      // outage still surfaces on the second throw.
      const transient = err instanceof TypeError;
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 250));
      return doFetch();
    }
  };

  return createBrowserClient(url, key, {
    global: { fetch: proxiedFetch },
  });
}
