/*
 * Seed a complete, RAG-testable project for a given customer + engineer.
 *
 *   npx tsx scripts/seed-rag-test.ts
 *
 * Creates (idempotently — re-running wipes and re-seeds the same project):
 *   • 1 project ("PlatePal — AI Meal Planning App") owned by the customer
 *   • 7 ended sessions (guest_calls) with AI summaries + next steps
 *   • long detailed chat threads (guest_messages)
 *   • voice transcripts (session_captions, 60s windows)
 *   • .txt and .xlsx attachments uploaded to the chat-attachments bucket
 *   • a client intake (client_intakes)
 *   • 2 quotes (project_quote_requests: golive committed + maintain quoted)
 * …then runs the RAG indexer (Qdrant + OpenAI embeddings) over the project.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, QDRANT_ENDPOINT,
 * QDRANT_KEY, OPENAI_API_KEY from .env.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ragServiceClient, indexProject } from "../lib/relay/rag/indexer";
import { ensureCollection } from "../lib/relay/rag/qdrant";
import {
  SESSIONS,
  PROJECT_META,
  PROJECT_NAME,
  CUSTOMER_NAME,
  ENGINEER_NAME,
  INTAKE,
  QUOTES,
  type SeedFile,
} from "./seed-rag-data";

const CUSTOMER_EMAIL = "gtlcustomer@yopmail.com";
const ENGINEER_EMAIL = "gtlengineer@yopmail.com";
const BUCKET = "chat-attachments";

async function findUserId(sb: SupabaseClient, email: string): Promise<string> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 1000) break;
  }
  throw new Error(`No auth user found for ${email} — create the account first (sign up once), then re-run.`);
}

function fileBuffer(f: SeedFile): Buffer {
  if ("content" in f) return Buffer.from(f.content, "utf8");
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(f.sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function iso(base: Date, plusSeconds: number): string {
  return new Date(base.getTime() + plusSeconds * 1000).toISOString();
}

async function main() {
  const sb = ragServiceClient();

  console.log("Looking up users…");
  const [customerId, engineerId] = await Promise.all([
    findUserId(sb, CUSTOMER_EMAIL),
    findUserId(sb, ENGINEER_EMAIL),
  ]);
  console.log(`  customer ${CUSTOMER_EMAIL} → ${customerId}`);
  console.log(`  engineer ${ENGINEER_EMAIL} → ${engineerId}`);

  // ── Project (idempotent: select by (customer_id, name), else insert) ────
  let projectId: string;
  {
    const { data: existing } = await sb
      .from("projects")
      .select("id")
      .eq("customer_id", customerId)
      .eq("name", PROJECT_NAME)
      .maybeSingle();
    if (existing) {
      projectId = existing.id as string;
    } else {
      const slug = `platepal-${randomUUID().slice(0, 8)}`;
      const { data: created, error: projErr } = await sb
        .from("projects")
        .insert({
          customer_id: customerId,
          name: PROJECT_NAME,
          slug,
          status: "active",
          description: "AI meal-planning web app (Next.js + Supabase + Stripe + OpenAI) — RAG seed project.",
          created_at: "2026-04-14T13:55:00Z",
        })
        .select("id")
        .single();
      if (projErr || !created) throw new Error(`project insert failed: ${projErr?.message}`);
      projectId = created.id as string;
    }
  }
  console.log(`Project: ${PROJECT_NAME} → ${projectId}`);

  // ── Wipe previous seed runs for this project ────────────────────────────
  console.log("Wiping any previous seed data for this project…");
  const { data: oldCalls } = await sb.from("guest_calls").select("id").eq("project_id", projectId);
  const oldIds = ((oldCalls ?? []) as { id: string }[]).map((r) => r.id);
  if (oldIds.length > 0) {
    // Remove storage objects under each old session folder.
    for (const sid of oldIds) {
      const { data: objs } = await sb.storage.from(BUCKET).list(sid, { limit: 100 });
      const paths = (objs ?? []).map((o) => `${sid}/${o.name}`);
      if (paths.length > 0) await sb.storage.from(BUCKET).remove(paths);
    }
    // guest_messages / attachments / captions cascade off guest_calls.
    await sb.from("guest_calls").delete().in("id", oldIds);
    console.log(`  removed ${oldIds.length} old session(s)`);
  }
  await sb.from("project_quote_requests").delete().eq("project_id", projectId);
  await sb.from("project_assistant_messages").delete().eq("project_id", projectId);

  // ── Project summary fields ──────────────────────────────────────────────
  {
    const { error } = await sb
      .from("projects")
      .update({
        ai_summary_title: PROJECT_META.ai_summary_title,
        ai_summary_overview: PROJECT_META.ai_summary_overview,
        summary: PROJECT_META.summary,
        ai_next_steps: PROJECT_META.ai_next_steps,
        summary_updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    if (error) throw new Error(`project summary update failed: ${error.message}`);
  }

  // ── Intake (unique on project_id + customer_user_id) ────────────────────
  {
    const { error } = await sb.from("client_intakes").upsert(
      {
        project_id: projectId,
        customer_user_id: customerId,
        familiarity: INTAKE.familiarity,
        ai_tools_used: INTAKE.ai_tools_used,
        developing: INTAKE.developing,
        technologies: INTAKE.technologies,
        created_at: "2026-04-14T13:58:00Z",
      },
      { onConflict: "project_id,customer_user_id" },
    );
    if (error) throw new Error(`intake upsert failed: ${error.message}`);
    console.log("Intake upserted.");
  }

  // ── Sessions ─────────────────────────────────────────────────────────────
  for (const [i, s] of SESSIONS.entries()) {
    const start = new Date(s.startsAt);
    const end = new Date(start.getTime() + s.durationMinutes * 60_000);

    const { data: call, error: callErr } = await sb
      .from("guest_calls")
      .insert({
        guest_name: CUSTOMER_NAME,
        guest_email: CUSTOMER_EMAIL,
        status: "ended",
        customer_user_id: customerId,
        claimed_by: engineerId,
        claimed_at: iso(start, -120),
        started_at: s.startsAt,
        ended_at: end.toISOString(),
        created_at: iso(start, -300),
        updated_at: end.toISOString(),
        free_minutes: 30,
        project_id: projectId,
        project_name: PROJECT_NAME,
        agent_name: ENGINEER_NAME,
        duration_minutes: s.durationMinutes,
        ai_summary_title: s.title,
        ai_summary_overview: s.overview,
        ai_next_steps: s.nextSteps,
        summary: s.summary,
        zoom_meeting_id: `9${(8210000000 + i * 1111).toString()}`,
      })
      .select("id")
      .single();
    if (callErr || !call) throw new Error(`session ${i + 1} insert failed: ${callErr?.message}`);
    const sessionId = call.id as string;

    // Chat messages, 75s apart; attachments hang off their message.
    let t = 0;
    for (const m of s.chat) {
      const createdAt = iso(start, t);
      t += 75;
      const { data: msg, error: msgErr } = await sb
        .from("guest_messages")
        .insert({
          guest_call_id: sessionId,
          sender_kind: m.from === "c" ? "guest" : "engineer",
          sender_id: m.from === "c" ? customerId : engineerId,
          sender_name: m.from === "c" ? CUSTOMER_NAME : ENGINEER_NAME,
          body: m.body,
          created_at: createdAt,
        })
        .select("id")
        .single();
      if (msgErr || !msg) throw new Error(`message insert failed (session ${i + 1}): ${msgErr?.message}`);

      if (m.attach) {
        const file = s.files.find((f) => f.name === m.attach);
        if (!file) throw new Error(`session ${i + 1}: chat references missing file ${m.attach}`);
        const buf = fileBuffer(file);
        const path = `${sessionId}/${randomUUID()}-${file.name}`;
        const { error: upErr } = await sb.storage
          .from(BUCKET)
          .upload(path, buf, { contentType: file.mime, upsert: false });
        if (upErr) throw new Error(`upload ${file.name} failed: ${upErr.message}`);
        const { error: attErr } = await sb.from("guest_message_attachments").insert({
          message_id: msg.id as string,
          path,
          name: file.name,
          mime: file.mime,
          size_bytes: buf.byteLength,
          kind: file.kind,
          created_at: createdAt,
        });
        if (attErr) throw new Error(`attachment row ${file.name} failed: ${attErr.message}`);
      }
    }

    // Voice captions — 60s windows starting 2 minutes in.
    const capRows = s.captions.map((c, j) => ({
      session_id: sessionId,
      zoom_meeting_id: `9${(8210000000 + i * 1111).toString()}`,
      speaker: c.who === "c" ? CUSTOMER_NAME : ENGINEER_NAME,
      text: c.text,
      window_start: iso(start, 120 + j * 60),
      window_end: iso(start, 180 + j * 60),
      created_at: iso(start, 180 + j * 60),
    }));
    const { error: capErr } = await sb.from("session_captions").insert(capRows);
    if (capErr) throw new Error(`captions insert failed (session ${i + 1}): ${capErr.message}`);

    console.log(
      `Session ${i + 1}/7 "${s.title}" → ${sessionId} (${s.chat.length} msgs, ${s.captions.length} captions, ${s.files.length} file(s))`,
    );
  }

  // ── Quotes ───────────────────────────────────────────────────────────────
  for (const q of QUOTES) {
    const { error } = await sb.from("project_quote_requests").insert({
      customer_user_id: customerId,
      project_id: projectId,
      kind: q.kind,
      status: q.status,
      quote_amount_cents: q.quote_amount_cents,
      bid_scope: q.bid_scope,
      bid_timeline: q.bid_timeline,
      comments: q.comments,
      customer_response_note: q.customer_response_note,
      responded_by: engineerId,
      created_at: q.createdAt,
      responded_at: q.respondedAt,
      ...(q.status === "committed"
        ? { committed_at: q.respondedAt, paid_at: q.respondedAt, customer_viewed_at: q.respondedAt }
        : { customer_viewed_at: q.respondedAt }),
    });
    if (error) throw new Error(`quote (${q.kind}) insert failed: ${error.message}`);
  }
  console.log(`Quotes inserted: ${QUOTES.map((q) => `${q.kind}=${q.status}`).join(", ")}`);

  // ── Index into Qdrant ────────────────────────────────────────────────────
  console.log("\nIndexing project into Qdrant (OpenAI embeddings)…");
  await ensureCollection();
  const r = await indexProject(sb, projectId);
  console.log(`Indexed ${r.sessions} session(s), ${r.chunks} chunk(s).`);

  console.log(`\nDone. Open: /staff/project/${projectId}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nSEED FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
