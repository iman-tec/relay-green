/*
 * stubDraftAttachments — IndexedDB-backed store for attachments staged
 * BEFORE a Relay session exists.
 *
 * The customer-facing ChatPanelStub (RoomClient.tsx) used to disable the
 * paperclip + voice-record buttons because guest_message_attachments has
 * a NOT NULL FK to guest_messages, and that table requires a guest_call_id.
 * No session → no message → nowhere to attach. Customers had to wait for
 * the engineer to join before they could attach anything, which broke
 * the "prepare your session in advance" promise.
 *
 * This module bridges the gap. The composer writes Blob + metadata here
 * (IndexedDB handles Blobs natively + has GB-scale storage, unlike the
 * 5-10 MB localStorage cap). When the next session goes live,
 * flushAttachmentsToSession reads the queue, uploads to the
 * chat-attachments storage bucket under the new sessionId, creates a
 * single system guest_messages row, attaches everything to it, and
 * clears the local queue.
 *
 * Key choices:
 *   - One global queue per device (not per-project) — matches the existing
 *     STUB_DRAFT_STORAGE_KEY semantics. The customer is preparing for
 *     *some* upcoming session; whichever they kick off next gets the
 *     pending attachments. If they need per-project staging in the future,
 *     SessionPrepView is the right surface (it's already scoped by project).
 *   - Blobs go to IndexedDB, not localStorage. localStorage is
 *     synchronous + string-only + 5MB; a single voice note can blow past
 *     that limit easily.
 *   - We keep the kind classification (image/document/audio) so the
 *     UI tray can render the right icon without re-running classify().
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { classify, uploadOne, type AttachmentKind } from "./chatAttachments";

const DB_NAME = "relay-stub-drafts";
const DB_VERSION = 1;
const STORE = "attachments";

export type StubAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** When this row was added — newest-first sort in the UI. */
  addedAt: number;
  /** The raw blob; persisted directly in IDB. */
  blob: Blob;
};

/** Lightweight metadata returned from list() — does NOT carry the Blob. */
export type StubAttachmentMeta = Omit<StubAttachment, "blob">;

// ── IDB plumbing ──────────────────────────────────────────────────────
// We open the DB on demand, not at module load, so SSR/hydration code
// that imports this module doesn't trigger an IDB call in environments
// without `indexedDB` (the Vercel build step, jest).
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Stage a File (from file picker or MediaRecorder output) for later
 * delivery. Validates kind client-side; throws if the type isn't one
 * we accept. Returns the new attachment's id.
 */
export async function addAttachment(file: File): Promise<StubAttachmentMeta> {
  const kind = classify(file);
  if (!kind) {
    throw new Error("Unsupported file type. PDF, DOCX, XLSX, TXT, images, or audio.");
  }
  const item: StubAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    kind,
    addedAt: Date.now(),
    blob: file,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB add failed"));
  });
  db.close();
  // Strip blob from the return value — the UI only needs metadata to
  // render the tray. Avoids accidentally serializing the blob through
  // React state or sending it to devtools.
  const { blob: _blob, ...meta } = item;
  void _blob;
  return meta;
}

/** List all pending attachments (metadata only, no Blobs). Newest first. */
export async function listAttachments(): Promise<StubAttachmentMeta[]> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return []; }
  const items = await new Promise<StubAttachment[]>((resolve, reject) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => resolve(req.result as StubAttachment[]);
    req.onerror = () => reject(req.error ?? new Error("IDB getAll failed"));
  });
  db.close();
  return items
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(({ blob: _b, ...meta }) => { void _b; return meta; });
}

export async function removeAttachment(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
  });
  db.close();
}

export async function clearAttachments(): Promise<void> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return; }
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB clear failed"));
  });
  db.close();
}

// Internal — read both meta and Blob for the flush path.
async function readAllWithBlobs(): Promise<StubAttachment[]> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return []; }
  const items = await new Promise<StubAttachment[]>((resolve, reject) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => resolve(req.result as StubAttachment[]);
    req.onerror = () => reject(req.error ?? new Error("IDB getAll failed"));
  });
  db.close();
  return items.sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * Move every pending attachment from IndexedDB into the live session.
 *
 * 1. Re-hydrates each Blob into a File so the existing uploadOne helper
 *    can take it (uploadOne writes under `{sessionId}/{uuid}-{name}`).
 * 2. Inserts ONE system guest_messages row labelled
 *    "📎 Customer prepared these files before the call:"
 * 3. Inserts a guest_message_attachments row per uploaded file, all
 *    bound to that single system message.
 * 4. Clears the IDB queue ONLY on success — partial failure leaves the
 *    queue intact so the customer can retry, manually or on the next
 *    auto-flush tick.
 *
 * Caller is responsible for triggering this when session status reaches
 * a live state (assigned / joining / live). It's a no-op if the queue
 * is empty so re-firing the same effect is safe.
 *
 * Returns the count uploaded. Throws on storage/RPC errors so the
 * caller can show a toast.
 */
export async function flushAttachmentsToSession(args: {
  sb: SupabaseClient;
  sessionId: string;
  /** Override the system-message body if you want a non-default label. */
  systemBody?: string;
}): Promise<number> {
  const { sb, sessionId, systemBody } = args;
  const items = await readAllWithBlobs();
  if (items.length === 0) return 0;

  // Step 1: upload all blobs. uploadOne handles the storage path layout
  // + content-type header. We collect the uploaded metadata so we can
  // create the attachment rows after the parent message is inserted.
  type Pending = { uploaded: Awaited<ReturnType<typeof uploadOne>>; kind: AttachmentKind };
  const uploaded: Pending[] = [];
  for (const it of items) {
    const file = new File([it.blob], it.name, { type: it.mime });
    const u = await uploadOne({ sb, sessionId, file, kind: it.kind });
    uploaded.push({ uploaded: u, kind: it.kind });
  }

  // Step 2: insert the parent system message. RLS on guest_messages
  // allows INSERT for authenticated callers; the customer's auth cookie
  // is enough since they own the session.
  const body = systemBody
    ?? "📎 Customer prepared these files before the call:";
  const { data: msg, error: msgErr } = await sb
    .from("guest_messages")
    .insert({
      guest_call_id: sessionId,
      sender_kind: "system",
      sender_name: "Relay",
      body,
    })
    .select("id")
    .single();
  if (msgErr || !msg) throw new Error(msgErr?.message ?? "Couldn't post the prep message.");

  // Step 3: bulk-insert the attachment rows. All rows point at the
  // same parent message so the engineer's UI groups them together.
  const rows = uploaded.map(({ uploaded: u, kind }) => ({
    message_id: msg.id,
    path: u.path,
    name: u.name,
    mime: u.mime,
    size_bytes: u.size,
    kind,
  }));
  const { error: attErr } = await sb.from("guest_message_attachments").insert(rows);
  if (attErr) throw new Error(attErr.message);

  // Step 4: clear local queue only on full success.
  await clearAttachments();
  return uploaded.length;
}
