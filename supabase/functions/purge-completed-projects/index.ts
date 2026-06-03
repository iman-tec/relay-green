/*
 * purge-completed-projects — 90-day retention sweeper.
 *
 * For every project where completion_status='completed' and the 90-day
 * clock has elapsed:
 *
 *   1. Find every chat_attachments row attached to a session in the
 *      project (via guest_messages → guest_calls → projects).
 *   2. Delete those objects from Supabase Storage.
 *   3. Mark the chat_attachments rows purged=true (we keep the row so
 *      the chat history UI shows a "Removed after retention" placeholder
 *      rather than a broken card).
 *   4. Flip the project to completion_status='archived'.
 *
 * Trigger: schedule via Supabase pg_cron (daily at 03:00 UTC) or hit the
 * function URL from any external scheduler. Idempotent — running twice
 * in a row finds nothing the second time.
 *
 * Why a function and not pure SQL: deleting Storage objects requires the
 * service-role REST API, which pg_cron can't reach. The function brokers
 * the SQL+Storage interaction safely.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PURGE_CRON_SECRET   shared secret expected in `x-cron-secret` header
 *                       so this endpoint isn't openly callable.
 *   STORAGE_BUCKET      defaults to "chat-attachments" — set to whatever
 *                       chat_attachments.path actually lives under.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PURGE_CRON_SECRET         = Deno.env.get("PURGE_CRON_SECRET") ?? "";
const STORAGE_BUCKET            = Deno.env.get("STORAGE_BUCKET") ?? "chat-attachments";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ProjectRow = {
  id: string;
  customer_id: string;
  name: string;
  completed_at: string | null;
};

type AttachmentRow = {
  id: string;
  path: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Shared-secret guard so the endpoint isn't openly callable from the
  // internet. The scheduler (pg_cron, Vercel cron, etc.) needs to send
  // this header.
  const incomingSecret = req.headers.get("x-cron-secret");
  if (!PURGE_CRON_SECRET || incomingSecret !== PURGE_CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. List projects whose retention clock has elapsed.
  const { data: projects, error: listErr } = await admin
    .rpc("list_projects_ready_for_purge");
  if (listErr) {
    console.error("[purge] list_projects_ready_for_purge failed", listErr);
    return new Response(JSON.stringify({ error: listErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const ready = (projects ?? []) as ProjectRow[];
  if (ready.length === 0) {
    return new Response(JSON.stringify({ purged: 0, projects: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: { projectId: string; name: string; objectCount: number; storageErr?: string }[] = [];

  for (const project of ready) {
    // 2. Find every attachment row for this project's sessions.
    // We walk: guest_message_attachments → guest_messages.guest_call_id →
    // guest_calls.project_id. Filter to unpurged only (we keep the row
    // after the delete; second pass shouldn't re-fetch them).
    // NB: the table is guest_message_attachments — the original code (and
    // the 20260526110000 migration) said `chat_attachments`, a table that
    // never existed; fixed alongside 20260603120000.
    const { data: attaches, error: aErr } = await admin
      .from("guest_message_attachments")
      .select("id, path, guest_messages!inner(guest_call_id, guest_calls!inner(project_id))")
      .eq("purged", false)
      .eq("guest_messages.guest_calls.project_id", project.id);
    if (aErr) {
      console.error("[purge] attachment fetch failed", project.id, aErr);
      results.push({ projectId: project.id, name: project.name, objectCount: 0, storageErr: aErr.message });
      continue;
    }

    const rows = (attaches ?? []) as AttachmentRow[];
    if (rows.length > 0) {
      // 3. Delete from Storage. Supabase Storage's remove() accepts an
      // array of paths and returns per-file results. We batch in chunks
      // of 100 to stay below per-request payload limits.
      const paths = rows.map((r) => r.path);
      const chunks: string[][] = [];
      for (let i = 0; i < paths.length; i += 100) chunks.push(paths.slice(i, i + 100));
      for (const chunk of chunks) {
        const { error: rmErr } = await admin.storage.from(STORAGE_BUCKET).remove(chunk);
        if (rmErr) {
          // Don't abort — the next chunk might still succeed. We'll surface
          // the error in the response so the operator knows.
          console.error("[purge] storage.remove failed", project.id, rmErr);
        }
      }
    }

    // 4. Flip rows to purged + project to archived. archive_project is
    // a SECURITY DEFINER RPC that handles the two updates atomically.
    const { error: archErr } = await admin.rpc("archive_project", {
      _project_id: project.id,
    });
    if (archErr) {
      console.error("[purge] archive_project failed", project.id, archErr);
      results.push({ projectId: project.id, name: project.name, objectCount: rows.length, storageErr: archErr.message });
      continue;
    }

    results.push({ projectId: project.id, name: project.name, objectCount: rows.length });
  }

  return new Response(JSON.stringify({
    purged: results.length,
    projects: results,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
