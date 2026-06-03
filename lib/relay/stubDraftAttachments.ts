/*
 * stubDraftAttachments — IndexedDB-backed store for attachments staged
 * BEFORE a Relay session exists.
 *
 * Now SCOPED per project. The original "one global queue" model meant
 * a file attached while preparing project A would later flush into
 * project B's session if A was abandoned. Customers expected each
 * project's draft chat to be isolated — so every row now carries a
 * `scope` string (the project id, or "general" for the no-project
 * scratchpad). Every function takes an explicit scope; the older
 * signatures that didn't take one have been dropped, and all callers
 * pass scope explicitly.
 *
 * Used by the customer-facing ChatPanelStub (RoomClient.tsx) — its
 * paperclip + voice-record buttons write to this queue, and the
 * parent's auto-flush effect moves them into a real session
 * (guest_message_attachments rows) when the customer rings.
 *
 * Storage layout: one IDB object store `attachments`, keyed by id,
 * with a `scope` field on each row + a `by_scope` index for fast
 * per-scope queries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classify,
  uploadOne,
  MAX_FILES_PER_MESSAGE,
  type AttachmentKind,
} from "./chatAttachments";

const DB_NAME = "relay-stub-drafts";
// v2 adds the `scope` field + `by_scope` index. v1 rows (if any
// exist locally from an earlier session) get migrated on upgrade —
// we tag them with scope="general" so they aren't lost.
const DB_VERSION = 2;
const STORE = "attachments";
const SCOPE_INDEX = "by_scope";

export type StubAttachment = {
  id: string;
  scope: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** When this row was added — newest-first sort in the UI. */
  addedAt: number;
  /** The raw blob; persisted directly in IDB. */
  blob: Blob;
};

/** Metadata returned from list() — does NOT carry the Blob. */
export type StubAttachmentMeta = Omit<StubAttachment, "blob">;

// ── IDB plumbing ──────────────────────────────────────────────────────
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Fresh install — create the store + index from scratch.
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(SCOPE_INDEX, "scope", { unique: false });
        return;
      }
      // Upgrade path: store exists from v1 (no `scope` field, no index).
      // Backfill scope="general" on each row + create the index.
      const tx = req.transaction;
      if (!tx) return;
      const store = tx.objectStore(STORE);
      if (!store.indexNames.contains(SCOPE_INDEX)) {
        // Walk every row and stamp scope="general" if missing.
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            // Done walking — now create the index.
            store.createIndex(SCOPE_INDEX, "scope", { unique: false });
            return;
          }
          const value = cursor.value as Partial<StubAttachment>;
          if (!value.scope) {
            cursor.update({ ...value, scope: "general" });
          }
          cursor.continue();
        };
      }
      void event;
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
 * Stage a File (from file picker or MediaRecorder output) under a
 * specific scope. Validates client-side; throws if the type isn't
 * accepted. Returns the new attachment's metadata.
 */
export async function addAttachment(file: File, scope: string): Promise<StubAttachmentMeta> {
  const kind = classify(file);
  if (!kind) {
    throw new Error("Unsupported file type. PDF, DOCX, XLSX, TXT, images, or audio.");
  }
  const item: StubAttachment = {
    id: crypto.randomUUID(),
    scope: scope || "general",
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
  const { blob: _blob, ...meta } = item;
  void _blob;
  return meta;
}

/** List pending attachments for a scope. Newest first. */
export async function listAttachments(scope: string): Promise<StubAttachmentMeta[]> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return []; }
  const items = await new Promise<StubAttachment[]>((resolve, reject) => {
    const store = tx(db, "readonly");
    const idx = store.index(SCOPE_INDEX);
    const req = idx.getAll(scope || "general");
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

/** Clear all attachments for a specific scope. */
export async function clearAttachments(scope: string): Promise<void> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return; }
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite");
    const idx = store.index(SCOPE_INDEX);
    const req = idx.openCursor(scope || "general");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("IDB clear failed"));
  });
  db.close();
}

// Internal — read both meta and Blob for a specific scope, used by flush.
async function readScopeWithBlobs(scope: string): Promise<StubAttachment[]> {
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return []; }
  const items = await new Promise<StubAttachment[]>((resolve, reject) => {
    const store = tx(db, "readonly");
    const idx = store.index(SCOPE_INDEX);
    const req = idx.getAll(scope || "general");
    req.onsuccess = () => resolve(req.result as StubAttachment[]);
    req.onerror = () => reject(req.error ?? new Error("IDB getAll failed"));
  });
  db.close();
  return items.sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * Flush every pending attachment in a given scope into a live session.
 *
 * Uploads all blobs to the chat-attachments bucket under the new
 * sessionId, then posts them as REGULAR customer chat bubbles
 * (attachment-only guest messages, chunked at the per-message file cap)
 * so they're clearly visible in the timeline — not tucked under a
 * system pill. Clears the scope's queue only on full success — partial
 * failure leaves the queue intact for retry.
 *
 * Caller is responsible for picking the right scope (typically the
 * session's project_id, or "general" when projectless) and passing the
 * customer's resolved display name. Returns the count uploaded.
 */
export async function flushAttachmentsToSession(args: {
  sb: SupabaseClient;
  sessionId: string;
  scope: string;
  /** Customer display name for the chat bubble header (falls back to "Customer"). */
  senderName?: string | null;
  /** Customer auth user id, when known. */
  senderId?: string | null;
}): Promise<number> {
  const { sb, sessionId, scope, senderName, senderId } = args;
  const items = await readScopeWithBlobs(scope);
  if (items.length === 0) return 0;

  type Pending = { uploaded: Awaited<ReturnType<typeof uploadOne>>; kind: AttachmentKind };
  const uploaded: Pending[] = [];
  for (const it of items) {
    const file = new File([it.blob], it.name, { type: it.mime });
    const u = await uploadOne({ sb, sessionId, file, kind: it.kind });
    uploaded.push({ uploaded: u, kind: it.kind });
  }

  // Chunk into messages of MAX_FILES_PER_MESSAGE so the flush honours the
  // same per-message cap the composers enforce (and stays under the DB
  // image-cap trigger). The queue can legitimately hold more than one
  // message's worth — staged across multiple visits before the call.
  for (let i = 0; i < uploaded.length; i += MAX_FILES_PER_MESSAGE) {
    const chunk = uploaded.slice(i, i + MAX_FILES_PER_MESSAGE);
    const { data: msg, error: msgErr } = await sb
      .from("guest_messages")
      .insert({
        guest_call_id: sessionId,
        sender_kind: "guest",
        sender_name: (senderName ?? "").trim() || "Customer",
        sender_id: senderId ?? null,
        // Attachment-only bubble — the files ARE the message.
        body: null,
      })
      .select("id")
      .single();
    if (msgErr || !msg) throw new Error(msgErr?.message ?? "Couldn't post the prepared files.");

    const rows = chunk.map(({ uploaded: u, kind }) => ({
      message_id: msg.id,
      path: u.path,
      name: u.name,
      mime: u.mime,
      size_bytes: u.size,
      kind,
    }));
    const { error: attErr } = await sb.from("guest_message_attachments").insert(rows);
    if (attErr) throw new Error(attErr.message);
  }

  await clearAttachments(scope);
  return uploaded.length;
}
