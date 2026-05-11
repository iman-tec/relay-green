// Signs a Zoom Meeting SDK JWT so the browser SDK can join a meeting.
// Uses the dedicated Meeting SDK credentials for the JWT, AND the
// Server-to-Server OAuth credentials to look up the meeting's passcode
// (Zoom auto-generates one based on account defaults).
//
// For role=1 (host) joins we MUST return a zak token, otherwise the
// Web Meeting SDK rejects with a non-enumerable Reason (which surfaces
// in the browser as `[ZoomEmbed] join failed {}`). The CREATE-MEETING
// API embeds zak in start_url; the GET-MEETING API does not. So we
// look up the start_url we already saved in `guest_calls.zoom_start_url`
// during minting, and read zak from there.
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getZoomAccessToken(): Promise<string | null> {
  const accountId = Deno.env.get("ZOOM_ACCOUNT_ID");
  const clientId = Deno.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) return null;
  const basic = btoa(`${clientId}:${clientSecret}`);
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  if (!r.ok) return null;
  const data = await r.json();
  return (data.access_token as string) ?? null;
}

async function fetchMeetingInfo(
  meetingId: string,
): Promise<{ password: string; hostId: string | null; startUrl: string | null } | null> {
  try {
    const token = await getZoomAccessToken();
    if (!token) return null;
    const r = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      password: (d.password as string) ?? "",
      hostId: (d.host_id as string) ?? null,
      startUrl: (d.start_url as string) ?? null,
    };
  } catch {
    return null;
  }
}

// Extract the embedded zak param from a Zoom start_url. This avoids hitting
// /users/{id}/token (which needs user:read:admin scope on the S2S app).
function zakFromStartUrl(startUrl: string | null): string | null {
  if (!startUrl) return null;
  try {
    return new URL(startUrl).searchParams.get("zak");
  } catch {
    return null;
  }
}

async function fetchHostZak(hostId: string): Promise<string | null> {
  try {
    const token = await getZoomAccessToken();
    if (!token) return null;
    const r = await fetch(`https://api.zoom.us/v2/users/${hostId}/token?type=zak`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.token as string) ?? null;
  } catch {
    return null;
  }
}

async function zakFromDb(meetingNumber: string): Promise<{ zak: string | null; startUrl: string | null }> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return { zak: null, startUrl: null };
    const sb = createClient(url, key);
    const { data } = await sb
      .from("guest_calls")
      .select("zoom_start_url")
      .eq("zoom_meeting_id", meetingNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const startUrl = (data as { zoom_start_url: string | null } | null)?.zoom_start_url ?? null;
    return { zak: zakFromStartUrl(startUrl), startUrl };
  } catch {
    return { zak: null, startUrl: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { meetingNumber, role } = await req.json();
    if (!meetingNumber) {
      return new Response(JSON.stringify({ error: "meetingNumber required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sdkKey = Deno.env.get("ZOOM_SDK_KEY");
    const sdkSecret = Deno.env.get("ZOOM_SDK_SECRET");
    if (!sdkKey || !sdkSecret) {
      return new Response(JSON.stringify({ error: "ZOOM_SDK_KEY/SECRET not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanMn = String(meetingNumber).replace(/\D/g, "");
    const iat = getNumericDate(0);
    const exp = getNumericDate(60 * 60 * 2); // 2h

    const payload = {
      appKey: sdkKey,
      sdkKey,
      mn: cleanMn,
      role: role === 1 ? 1 : 0,
      iat,
      exp,
      tokenExp: exp,
    };

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(sdkSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const signature = await create({ alg: "HS256", typ: "JWT" }, payload, key);

    // Always look up the password from Zoom (GET-meeting works for that).
    const info = await fetchMeetingInfo(cleanMn);

    // For host (role=1) we need zak. Zoom's GET-meeting API DOES NOT include
    // zak in start_url — only CREATE-meeting does. Our mint function saved
    // that fresh start_url into guest_calls.zoom_start_url; read it from
    // there. Fall back to GET-meeting's start_url, then to /users/{id}/token
    // (which needs user:read:admin scope — usually not granted).
    let zak: string | null = null;
    if (role === 1) {
      const fromDb = await zakFromDb(cleanMn);
      zak = fromDb.zak ?? zakFromStartUrl(info?.startUrl ?? null);
      if (!zak && info?.hostId) {
        zak = await fetchHostZak(info.hostId);
      }
      if (!zak) {
        console.warn("[zoom-sdk-signature] host requested but no zak found", {
          meetingNumber: cleanMn,
          hadStoredStartUrl: !!fromDb.startUrl,
          hadApiStartUrl: !!info?.startUrl,
          hadHostId: !!info?.hostId,
        });
      }
    }

    return new Response(
      JSON.stringify({ signature, sdkKey, password: info?.password ?? "", zak: zak ?? "" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
