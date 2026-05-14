/*
 * Chat-attachment helpers shared by the customer + engineer composers and
 * session hooks. Single source of truth for accepted file types, the
 * 50 MB / 3-image caps, the storage path layout, and the upload + signed
 * URL plumbing.
 *
 * All checks happen client-side for fast feedback. The database CHECK
 * constraint + image-cap trigger + bucket file_size_limit are the
 * server-side defence in depth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_BYTES = 52_428_800;          // 50 MB
export const MAX_IMAGES_PER_MESSAGE = 3;

export const ACCEPTED_DOC_MIME = new Set<string>([
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel",                                          // .xls (legacy)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword",                                                // .doc (legacy)
]);

export const ACCEPTED_DOC_EXT = [".pdf", ".txt", ".xlsx", ".docx"] as const;

const IMAGE_MIME_PREFIX = "image/";

export type AttachmentKind = "image" | "document";

export function classify(file: File): AttachmentKind | null {
  if (file.type && file.type.startsWith(IMAGE_MIME_PREFIX)) return "image";
  if (file.type && ACCEPTED_DOC_MIME.has(file.type)) return "document";
  // Some platforms strip mime on drag-drop — fall back to extension.
  const lower = file.name.toLowerCase();
  if (ACCEPTED_DOC_EXT.some((ext) => lower.endsWith(ext))) return "document";
  if (/\.(jpe?g|png|webp|gif)$/i.test(lower)) return "image";
  return null;
}

export type ClassifiedFile = { file: File; kind: AttachmentKind };

export type ValidationResult =
  | { ok: true; classified: ClassifiedFile[] }
  | { ok: false; error: string };

/**
 * Run mime + size + per-image-count checks on a candidate batch. Pass
 * `existing` to validate an incremental add (e.g. dragging more onto an
 * already-staged batch) — counts both sets together.
 */
export function validateStagedFiles(
  incoming: File[],
  existing: ClassifiedFile[] = [],
): ValidationResult {
  const classified: ClassifiedFile[] = [];
  for (const f of incoming) {
    const kind = classify(f);
    if (!kind) {
      return { ok: false, error: "PDF, DOCX, XLSX, TXT, or images only." };
    }
    if (f.size > MAX_BYTES) {
      return { ok: false, error: `${f.name} is over 50 MB.` };
    }
    classified.push({ file: f, kind });
  }
  const totalImages =
    existing.filter((c) => c.kind === "image").length +
    classified.filter((c) => c.kind === "image").length;
  if (totalImages > MAX_IMAGES_PER_MESSAGE) {
    return { ok: false, error: `Up to ${MAX_IMAGES_PER_MESSAGE} images per message.` };
  }
  return { ok: true, classified };
}

export type UploadedAttachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
};

/** Upload one file under `<sessionId>/<uuid>-<safe-filename>`. */
export async function uploadOne(args: {
  sb: SupabaseClient;
  sessionId: string;
  file: File;
  kind: AttachmentKind;
}): Promise<UploadedAttachment> {
  const { sb, sessionId, file, kind } = args;
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const path = `${sessionId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await sb.storage
    .from("chat-attachments")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return {
    path,
    name: file.name,
    mime: file.type || (kind === "image" ? "image/*" : "application/octet-stream"),
    size: file.size,
    kind,
  };
}

/** Bytes → "12.4 MB" / "640 KB" / "200 B". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mint a 1-hour signed URL for a stored attachment. */
export async function signedDownloadUrl(
  sb: SupabaseClient,
  path: string,
  downloadAs?: string,
): Promise<string | null> {
  const { data } = await sb.storage
    .from("chat-attachments")
    .createSignedUrl(path, 3600, downloadAs ? { download: downloadAs } : undefined);
  return data?.signedUrl ?? null;
}

/** The `accept` attribute strings for the two file-picker variants. */
export const FILE_INPUT_ACCEPT = {
  documents: ".pdf,.txt,.xlsx,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  images:    "image/*",
} as const;
