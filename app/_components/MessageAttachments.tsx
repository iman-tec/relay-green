"use client";

/*
 * Renders the attachments slot of a chat bubble.
 *
 * Images (max 3 per message) render as a small grid:
 *   1 image  → single full-width thumbnail (capped)
 *   2 images → 2-up
 *   3 images → 3-up
 * Click an image to open the signed URL in a new tab.
 *
 * Document attachments render as stacked cards with a mime-based icon,
 * filename, formatted size, and a Download button that mints a fresh
 * signed URL on click.
 */

import { useState } from "react";
import {
  Download, FileText, FileSpreadsheet, FileType, Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestMessageAttachment } from "@/lib/supabase/types";
import { formatBytes, signedDownloadUrl } from "@/lib/relay/chatAttachments";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

export function MessageAttachments({
  attachments,
}: {
  attachments: GuestMessageAttachment[] | null | undefined;
}) {
  if (!attachments || attachments.length === 0) return null;
  const images = attachments.filter((a) => a.kind === "image").slice(0, 3);
  const docs   = attachments.filter((a) => a.kind === "document");

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && <ImageGrid items={images} />}
      {docs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {docs.map((a) => <DocumentCard key={a.id} attachment={a} />)}
        </div>
      )}
    </div>
  );
}

function ImageGrid({ items }: { items: GuestMessageAttachment[] }) {
  const cols = items.length === 1 ? "grid-cols-1" : items.length === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={`grid ${cols} gap-1.5`} style={{ maxWidth: 320 }}>
      {items.map((a) => <ImageTile key={a.id} attachment={a} single={items.length === 1} />)}
    </div>
  );
}

function ImageTile({ attachment, single }: { attachment: GuestMessageAttachment; single: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Fetch a fresh signed URL on mount.
  if (loading && !url) {
    const sb = createClient();
    void signedDownloadUrl(sb, attachment.path).then((u) => {
      setUrl(u);
      setLoading(false);
    });
  }

  const onDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDownloading(true);
    try {
      const sb = createClient();
      // Re-mint with `?download=<name>` so the browser actually saves the
      // file (instead of previewing it inline).
      const dlUrl = await signedDownloadUrl(sb, attachment.path, attachment.name);
      if (dlUrl) window.location.href = dlUrl;
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="group relative overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)" }}
    >
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="block transition-opacity hover:opacity-95"
        onClick={(e) => { if (!url) e.preventDefault(); }}
        title={attachment.name}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={attachment.name}
            loading="lazy"
            className="block h-full w-full object-cover"
            style={{ aspectRatio: single ? "16 / 10" : "1 / 1" }}
          />
        ) : (
          <div
            className="flex items-center justify-center"
            style={{
              aspectRatio: single ? "16 / 10" : "1 / 1",
              backgroundColor: BRAND_GREEN_SOFT,
            }}
          >
            <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        )}
      </a>
      {/* Always-visible download button on the image. */}
      <button
        type="button"
        onClick={(e) => void onDownload(e)}
        disabled={downloading || !url}
        title="Download image"
        aria-label={`Download ${attachment.name}`}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-opacity hover:opacity-100 disabled:opacity-40"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.55)",
          color: "#fff",
        }}
      >
        {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      </button>
    </div>
  );
}

function DocumentCard({ attachment }: { attachment: GuestMessageAttachment }) {
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const sb = createClient();
      const url = await signedDownloadUrl(sb, attachment.path, attachment.name);
      if (url) window.location.href = url;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
        maxWidth: 320,
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <DocIcon name={attachment.name} size={14} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[12px] font-medium" style={{ color: "var(--text)" }}>
          {attachment.name}
        </div>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {formatBytes(attachment.size_bytes)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={busy}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        style={{ color: "var(--text-muted)" }}
        title="Download"
        aria-label={`Download ${attachment.name}`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      </button>
    </div>
  );
}

function DocIcon({ name, size }: { name: string; size: number }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return <FileSpreadsheet size={size} />;
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return <FileType size={size} />;
  return <FileText size={size} />;
}
