"use client";

/*
 * Shared chat composer used by both the customer (/room) and the engineer
 * (/staff/session/[id]) surfaces.
 *
 * Layout (Claude-style):
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [ chip ] [ chip ] [ chip ]            (staged files) │
 *   ├──────────────────────────────────────────────────────┤
 *   │ [+] | Type a message…                          [Send]│
 *   └──────────────────────────────────────────────────────┘
 *     Up to 50 MB per file · 3 images max · PDF / DOCX / …
 *
 * "+" opens a small popover with two actions:
 *   • Add files  → .pdf, .txt, .xlsx, .docx
 *   • Photo      → image/* (max 3 per message)
 *
 * Drag-and-drop is supported on the whole composer area; the same
 * validator runs in both paths.
 *
 * The component is "controlled-on-send" — it owns the text + staged-files
 * state internally and surfaces a single onSend({ text, files }) callback.
 */

import { useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon, FileText, FileSpreadsheet, FileType,
  Loader2, Paperclip, Plus, SendHorizonal, X,
} from "lucide-react";
import {
  type ClassifiedFile, type AttachmentKind,
  FILE_INPUT_ACCEPT, MAX_BYTES, MAX_IMAGES_PER_MESSAGE,
  formatBytes, validateStagedFiles,
} from "@/lib/relay/chatAttachments";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

export function ChatComposer({
  disabled = false,
  placeholder,
  onSend,
}: {
  disabled?: boolean;
  placeholder: string;
  onSend: (payload: { text: string; files: File[] }) => Promise<void>;
}) {
  const [text,    setText]    = useState("");
  const [staged,  setStaged]  = useState<ClassifiedFile[]>([]);
  const [thumbs,  setThumbs]  = useState<Map<string, string>>(new Map());
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [menu,    setMenu]    = useState(false);
  const [hover,   setHover]   = useState(false);
  const fileDocsRef = useRef<HTMLInputElement>(null);
  const filePicsRef = useRef<HTMLInputElement>(null);
  const taRef       = useRef<HTMLTextAreaElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);

  // Generate / dispose object URLs for image thumbnails.
  useEffect(() => {
    const next = new Map<string, string>();
    for (const c of staged) {
      if (c.kind === "image") {
        next.set(c.file.name + c.file.size, URL.createObjectURL(c.file));
      }
    }
    setThumbs(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [staged]);

  // Auto-grow the textarea up to ~4 rows.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Close + menu on outside click.
  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menu]);

  const stage = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const v = validateStagedFiles(incoming, staged);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError(null);
    setStaged((prev) => [...prev, ...v.classified]);
  };

  const remove = (index: number) => {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (busy || disabled) return;
    const trimmed = text.trim();
    if (!trimmed && staged.length === 0) return;
    setBusy(true);
    try {
      await onSend({ text: trimmed, files: staged.map((c) => c.file) });
      setText("");
      setStaged([]);
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHover(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    stage(files);
  };

  // Clipboard paste — screenshots (Cmd/Ctrl+V) arrive as image files on the
  // clipboard. Pull them out and stage them; let plain-text pastes fall
  // through to the textarea untouched.
  const onPaste = (e: React.ClipboardEvent) => {
    if (disabled) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgs = items
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (imgs.length === 0) return;
    e.preventDefault();
    stage(imgs);
  };

  const accentBorder = hover ? BRAND_GREEN : "var(--border)";

  return (
    <div
      ref={wrapRef}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      className="relative w-full"
    >
      {/* Hidden inputs driven by the + menu */}
      <input
        ref={fileDocsRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT.documents}
        className="hidden"
        onChange={(e) => {
          stage(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={filePicsRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT.images}
        className="hidden"
        onChange={(e) => {
          stage(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {error && (
        <div
          className="mb-1.5 rounded-md border px-3 py-1.5 text-[12px]"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="flex flex-col gap-2 rounded-2xl border px-3 py-2 transition-colors"
        style={{
          borderColor: accentBorder,
          backgroundColor: "var(--surface)",
        }}
      >
        {/* Staged-files strip */}
        {staged.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {staged.map((c, i) => (
              <StagedChip
                key={`${c.file.name}-${i}`}
                kind={c.kind}
                name={c.file.name}
                size={c.file.size}
                thumb={c.kind === "image" ? thumbs.get(c.file.name + c.file.size) : undefined}
                onRemove={() => remove(i)}
              />
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          {/* + button */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => !disabled && setMenu((v) => !v)}
              disabled={disabled}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{ color: "var(--text-muted)" }}
              title="Add files or photos"
              aria-label="Add files or photos"
            >
              <Plus size={16} />
            </button>
            {menu && (
              <div
                className="absolute bottom-full left-0 mb-2 w-44 overflow-hidden rounded-xl border shadow-lg"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface)",
                }}
              >
                <MenuItem
                  icon={Paperclip}
                  label="Add files"
                  sub="PDF, DOCX, XLSX, TXT"
                  onClick={() => {
                    setMenu(false);
                    fileDocsRef.current?.click();
                  }}
                />
                <MenuItem
                  icon={ImageIcon}
                  label="Photo"
                  sub={`Up to ${MAX_IMAGES_PER_MESSAGE} images`}
                  onClick={() => {
                    setMenu(false);
                    filePicsRef.current?.click();
                  }}
                />
              </div>
            )}
          </div>

          {/* Textarea */}
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-snug outline-none placeholder:opacity-60 disabled:opacity-60"
            style={{
              color: "var(--text)",
              maxHeight: 120,
            }}
          />

          {/* Send button */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={disabled || busy || (!text.trim() && staged.length === 0)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: BRAND_GREEN }}
            title="Send"
            aria-label="Send"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
        Up to {formatBytes(MAX_BYTES)} per file · {MAX_IMAGES_PER_MESSAGE} images max · PDF, DOCX, XLSX, TXT, or images.
      </p>

      {/* Drop overlay */}
      {hover && !disabled && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-dashed"
          style={{
            borderColor: BRAND_GREEN,
            backgroundColor: BRAND_GREEN_SOFT,
          }}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon, label, sub, onClick,
}: {
  icon: React.ElementType;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
    >
      <Icon size={14} style={{ color: BRAND_GREEN }} />
      <div className="min-w-0">
        <div className="text-sm" style={{ color: "var(--text)" }}>{label}</div>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{sub}</div>
      </div>
    </button>
  );
}

function StagedChip({
  kind, name, size, thumb, onRemove,
}: {
  kind: AttachmentKind;
  name: string;
  size: number;
  thumb?: string;
  onRemove: () => void;
}) {
  return (
    <div
      className="group relative flex items-center gap-2 rounded-lg border pl-1.5 pr-7 py-1.5"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
    >
      {kind === "image" && thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt={name}
          className="h-9 w-9 rounded-md object-cover"
        />
      ) : (
        <span
          className="flex h-9 w-9 items-center justify-center rounded-md"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          <DocIcon name={name} size={14} />
        </span>
      )}
      <div className="min-w-0 max-w-[160px] leading-tight">
        <div className="truncate text-[12px]" style={{ color: "var(--text)" }}>{name}</div>
        <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
          {formatBytes(size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label={`Remove ${name}`}
        title="Remove"
      >
        <X size={11} />
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
