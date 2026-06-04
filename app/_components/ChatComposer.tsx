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
 *     Up to 10 MB per file · 3 files max · PDF / DOCX / …
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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon, FileText, FileSpreadsheet, FileType,
  Loader2, Paperclip, Plus, SendHorizonal, X, Mic, Music, Square, AudioLines,
} from "lucide-react";
import {
  type ClassifiedFile, type AttachmentKind,
  FILE_INPUT_ACCEPT, MAX_BYTES, MAX_FILES_PER_MESSAGE,
  formatBytes, validateStagedFiles,
} from "@/lib/relay/chatAttachments";

// ── Web Speech API type narrowing ────────────────────────────────────────
// SpeechRecognition is a browser-vendored type. We use a structural minimum
// because TS' DOM lib doesn't ship the prefixed/webkit shape consistently
// across versions.
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// Pick the best MIME for MediaRecorder. Chrome/Firefox produce audio/webm
// with opus; Safari produces audio/mp4 (m4a). We probe in priority order
// and let the browser pick its default if neither hint is supported.
function pickRecorderMime(): string | undefined {
  if (typeof window === "undefined" || !("MediaRecorder" in window)) return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of candidates) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((MediaRecorder as any).isTypeSupported?.(c)) return c;
  }
  return undefined;
}

function mimeToExt(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4"))  return "m4a";
  if (mime.includes("ogg"))  return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

// Query the Permissions API for the microphone's current state. Returns:
//   "granted"  — already allowed; getUserMedia will succeed without UI
//   "prompt"   — first time / not decided; getUserMedia will show the prompt
//   "denied"   — user previously blocked; the browser WILL NOT re-prompt
//                from JS, the user must change it in site-settings
//   "unknown"  — Permissions API unavailable or query failed; caller
//                should proceed with getUserMedia and handle errors
//
// Why this matters: when a user has previously clicked "Block" on the
// mic prompt, calling getUserMedia again rejects with NotAllowedError
// without showing any UI — they think they've never been asked. Detecting
// the "denied" state upfront lets us show actionable guidance instead.
export async function queryMicPermission(): Promise<"granted" | "prompt" | "denied" | "unknown"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

// Translate raw SpeechRecognitionErrorEvent.error codes into messages the
// customer can actually act on. The browser ships them as terse identifiers
// ("not-allowed", "service-not-allowed", "audio-capture") that look like
// raw API surface — wrapping them here keeps the UX consistent across all
// the surfaces that use the Web Speech API (ChatComposer + ChatPanelStub).
export function speechRecognitionErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
      // The vast-majority case: user clicked "Block" on the mic prompt,
      // or the origin had a remembered block. Tell them WHERE to fix it
      // — the lock icon in the address bar is the universal entry point.
      return "Microphone access blocked. Click the lock icon in your browser's address bar, allow microphone, then try again.";
    case "service-not-allowed":
      // The browser-level (or OS-level) speech service is disabled.
      // Common on hardened enterprise builds.
      return "Voice recognition is disabled in this browser or by your organization.";
    case "audio-capture":
      // No mic detected, or the mic is in use by another tab/app.
      return "No microphone detected. Check that one is plugged in and not being used by another app.";
    case "network":
      // The cloud speech service couldn't be reached. Chrome's
      // SpeechRecognition relies on Google's servers under the hood.
      return "Couldn't reach the voice recognition service. Check your network connection.";
    case "language-not-supported":
      return "Your browser doesn't support voice recognition for this language.";
    default:
      return `Voice recognition error: ${code}`;
  }
}

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

  // ── Voice state ──────────────────────────────────────────────────────
  // The composer supports two voice modes via a single Mic button:
  //   • Voice-to-text:   tap → start Web Speech API recognition; the
  //                      live transcript streams into the textarea so
  //                      the user can edit + send as a regular text
  //                      message. Tap again to stop.
  //   • Voice message:   long-press the same Mic button (>=300ms) → swap
  //                      into MediaRecorder mode and capture audio;
  //                      release to stop. The blob is staged as an
  //                      attachment (kind="audio") which sends via the
  //                      normal onSend flow.
  // We pick by gesture: a quick tap = transcribe, a hold = record.
  type VoiceMode = "idle" | "transcribing" | "recording";
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("idle");
  const [voiceMsg, setVoiceMsg]   = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  // Tracks the press timer that decides tap-vs-hold; cleared on release.
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of the text value BEFORE we start transcribing so the live
  // transcript appends after the existing draft instead of replacing it.
  const transcribeBaseRef = useRef<string>("");
  // True while the user WANTS dictation running — drives the onend
  // keep-alive restart (Chrome self-terminates recognition after short
  // silences; see startTranscribing).
  const transcribeKeepAliveRef = useRef(false);

  const fileDocsRef = useRef<HTMLInputElement>(null);
  const filePicsRef = useRef<HTMLInputElement>(null);
  const taRef       = useRef<HTMLTextAreaElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  // Track composer width so we can hide non-essential buttons (mic /
  // audio recorder) when the chat rail gets dragged narrow. Without
  // this the textarea gets squeezed to ~24px and the placeholder
  // becomes a single character.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < 280);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // ── Voice-to-text (Web Speech API) ────────────────────────────────────
  // Browser support is patchy: Chrome + Edge ship it under the webkit
  // prefix; Firefox/Safari either lack it or hide it behind a flag. We
  // probe at call time and fall back to a clear message if it's missing.
  const startTranscribing = useCallback(async () => {
    if (disabled || voiceMode !== "idle") return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceMsg("Voice-to-text isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    setVoiceMsg(null);
    setError(null);

    // Two-step permission check. First, query the Permissions API to see
    // if Chrome already has a "denied" verdict on record — if so, there
    // is NO way to re-prompt from JavaScript (browsers refuse to
    // re-show the prompt for security reasons); we have to send the
    // user to site-settings manually. Second, only if state is "prompt"
    // or "granted", call getUserMedia to actually trigger the prompt /
    // confirm the grant. This avoids the silent-fail case where
    // getUserMedia rejects with NotAllowedError but no prompt appears.
    const permState = await queryMicPermission();
    if (permState === "denied") {
      setVoiceMsg("Microphone is blocked for this site. Click the lock / info icon at the very left of the address bar → Site settings → Microphone → Allow → reload the page.");
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") {
          // Fell into NotAllowedError despite permState !== "denied" —
          // typically means the user dismissed the prompt this session.
          // Same fix path but slightly different copy so they know to
          // try again rather than dig through settings.
          setVoiceMsg("You dismissed the microphone prompt. Click the mic icon again and choose Allow when your browser asks.");
        } else if (e instanceof Error && e.name === "NotFoundError") {
          setVoiceMsg("No microphone detected. Check that one is plugged in and not being used by another app.");
        } else {
          setVoiceMsg("Couldn't access your microphone.");
        }
        return;
      }
    }

    transcribeBaseRef.current = text; // append, don't overwrite
    // KEEP-ALIVE LOOP. Chrome's SpeechRecognition self-terminates after a
    // short silence window (~5-8s); without restarting it, dictation died
    // mid-thought and the mic looked broken. While this flag is set every
    // onend spins up a fresh session; the finished session's finals get
    // folded into the base text so the next session APPENDS.
    transcribeKeepAliveRef.current = true;

    const startSession = () => {
      const r: SpeechRecognitionInstance = new Ctor();
      r.lang = navigator.language || "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1; // single hypothesis — fastest interim updates
      let sessionFinal = "";

      r.onresult = (event) => {
        let finalText = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else interim += res[0].transcript;
        }
        sessionFinal = finalText;
        // Combine: base draft + final phrases + the still-changing interim.
        const composed = [transcribeBaseRef.current, finalText, interim]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        setText(composed);
      };
      r.onerror = (event) => {
        // Quiet cases: "no-speech" fires when the user didn't say anything
        // in a window, "aborted" is normal teardown. The keep-alive in
        // onend rides through both. Real errors stop the loop with an
        // actionable message ("not-allowed" → how to fix it).
        if (event.error === "no-speech" || event.error === "aborted") return;
        setVoiceMsg(speechRecognitionErrorMessage(event.error));
        transcribeKeepAliveRef.current = false;
      };
      r.onend = () => {
        // Bank this session's finals before any restart — nothing lost,
        // nothing duplicated.
        if (sessionFinal.trim()) {
          transcribeBaseRef.current = [transcribeBaseRef.current, sessionFinal]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        }
        if (transcribeKeepAliveRef.current) {
          // Restart FAST — idle ms between sessions is dead air where
          // spoken words get dropped. 50ms dodges InvalidStateError on
          // back-to-back start(); one retry at 250ms before giving up.
          const restart = (delay: number, retriesLeft: number) => {
            window.setTimeout(() => {
              if (!transcribeKeepAliveRef.current) {
                setVoiceMode("idle");
                recognitionRef.current = null;
                return;
              }
              try {
                startSession();
              } catch {
                if (retriesLeft > 0) {
                  restart(250, retriesLeft - 1);
                } else {
                  setVoiceMode("idle");
                  recognitionRef.current = null;
                }
              }
            }, delay);
          };
          restart(50, 1);
          return;
        }
        setVoiceMode("idle");
        recognitionRef.current = null;
      };
      recognitionRef.current = r;
      r.start();
    };

    setVoiceMode("transcribing");
    try {
      startSession();
    } catch {
      // start() throws if called too quickly back-to-back. Recover by
      // resetting and letting the user tap again.
      setVoiceMsg("Voice recognition couldn't start — try again in a moment.");
      setVoiceMode("idle");
      recognitionRef.current = null;
      transcribeKeepAliveRef.current = false;
    }
  }, [disabled, voiceMode, text]);

  const stopTranscribing = useCallback(() => {
    transcribeKeepAliveRef.current = false;
    const r = recognitionRef.current;
    if (!r) {
      setVoiceMode("idle");
      return;
    }
    try { r.stop(); } catch { /* already stopping */ }
    // onend will flip state back to "idle".
  }, []);

  // ── Voice-recording (MediaRecorder → staged audio attachment) ─────────
  const startRecording = useCallback(async () => {
    if (disabled || voiceMode !== "idle") return;
    if (typeof window === "undefined" || !("MediaRecorder" in window)) {
      setVoiceMsg("Voice recording isn't supported in this browser.");
      return;
    }
    setVoiceMsg(null);
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // getUserMedia rejects on permission denial or absent mic. Mirror
      // the SpeechRecognition error copy so the customer sees the same
      // fix path regardless of which voice mode they tried.
      if (e instanceof Error && e.name === "NotAllowedError") {
        setVoiceMsg("Microphone access blocked. Click the lock icon in your browser's address bar, allow microphone, then try again.");
      } else if (e instanceof Error && e.name === "NotFoundError") {
        setVoiceMsg("No microphone detected. Check that one is plugged in and not being used by another app.");
      } else {
        setVoiceMsg("Couldn't access your microphone.");
      }
      return;
    }
    recorderStreamRef.current = stream;

    const mime = pickRecorderMime();
    const rec = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);

    recorderChunksRef.current = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(
        recorderChunksRef.current,
        { type: rec.mimeType || "audio/webm" },
      );
      recorderChunksRef.current = [];
      // Tear down the mic track so the browser indicator turns off.
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
      setVoiceMode("idle");

      // Stage the recording as a normal audio attachment. validateStagedFiles
      // will accept it (we extended classify() to recognize audio/*).
      const ext = mimeToExt(rec.mimeType || "audio/webm");
      const name = `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      const v = validateStagedFiles([file], staged);
      if (!v.ok) {
        setError(v.error);
        return;
      }
      setStaged((prev) => [...prev, ...v.classified]);
    };
    rec.onerror = () => {
      setVoiceMsg("Recording failed — try again.");
      setVoiceMode("idle");
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
    };

    recorderRef.current = rec;
    setVoiceMode("recording");
    rec.start();
  }, [disabled, voiceMode, staged]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r) {
      setVoiceMode("idle");
      return;
    }
    try { r.stop(); } catch { /* already stopping */ }
    // onstop handler will stage the blob + flip voiceMode back to "idle".
  }, []);

  // Tap-vs-hold gesture on the Mic button. Quick tap = voice-to-text;
  // hold (>=300 ms) = start recording. Release ends recording.
  const handleMicPointerDown = useCallback(() => {
    if (disabled || voiceMode !== "idle") return;
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      void startRecording();
    }, 300);
  }, [disabled, voiceMode, startRecording]);

  const handleMicPointerUp = useCallback(() => {
    // Timer still pending → it was a tap → toggle transcription.
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
      startTranscribing();
      return;
    }
    // Otherwise we were already recording; release stops it.
    if (voiceMode === "recording") stopRecording();
  }, [voiceMode, startTranscribing, stopRecording]);

  const handleMicClickWhileTranscribing = useCallback(() => {
    stopTranscribing();
  }, [stopTranscribing]);

  // Clean up on unmount so a navigation doesn't leave a hot mic stream.
  useEffect(() => {
    return () => {
      // Kill the dictation keep-alive FIRST or abort's onend would restart
      // recognition on a dead component.
      transcribeKeepAliveRef.current = false;
      try { recognitionRef.current?.abort(); } catch { /* noop */ }
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
    // Sending turns the mic OFF — dictation shouldn't keep capturing in
    // the background after the thought is sent. Interim words are already
    // in `text`, so nothing said is lost.
    if (transcribeKeepAliveRef.current || recognitionRef.current) {
      transcribeKeepAliveRef.current = false;
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
    }
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

  // Clipboard paste — ANY file on the clipboard (screenshots, copied
  // documents/PDFs from the OS file manager, audio files…) gets pulled
  // out and staged; validateStagedFiles inside stage() enforces the
  // mime whitelist + caps. Plain-text pastes fall through to the
  // textarea untouched.
  const onPaste = (e: React.ClipboardEvent) => {
    if (disabled) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    stage(files);
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
      {voiceMsg && (
        <div
          className="mb-1.5 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[12px]"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
            color: "var(--text-muted)",
          }}
        >
          <span className="flex items-center gap-2">
            <Music size={11} /> {voiceMsg}
          </span>
          <button
            type="button"
            onClick={() => setVoiceMsg(null)}
            className="opacity-60 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={11} />
          </button>
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
                  sub={`Up to ${MAX_FILES_PER_MESSAGE} files per message`}
                  onClick={() => {
                    setMenu(false);
                    filePicsRef.current?.click();
                  }}
                />
              </div>
            )}
          </div>

          {/* Two voice buttons, split for discoverability:
                • Mic     → voice-to-text dictation (transcript fills the
                            textarea, user edits + sends as text)
                • AudioLines → record a voice message (audio attachment
                            sent through the normal onSend pipeline)
              Each button is a clean click — no tap-vs-hold gesture — so
              the behavior is obvious without trial and error.
              Hidden when the composer is narrow (rail dragged thin) so
              the textarea isn't squeezed to nothing. The + menu and
              send button remain — voice features are recoverable when
              the rail is widened. */}
          <div className={`${narrow ? "hidden" : "flex"} shrink-0 items-center gap-1`}>
            {/* Voice-to-text */}
            <div className="relative">
              <button
                type="button"
                disabled={disabled || voiceMode === "recording"}
                onClick={voiceMode === "transcribing" ? stopTranscribing : () => void startTranscribing()}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                style={{
                  color: voiceMode === "transcribing" ? BRAND_GREEN : "var(--text-muted)",
                  backgroundColor: voiceMode === "transcribing" ? BRAND_GREEN_SOFT : "transparent",
                }}
                title={voiceMode === "transcribing" ? "Stop dictating" : "Dictate — voice to text"}
                aria-label="Dictate"
                aria-pressed={voiceMode === "transcribing"}
              >
                <Mic size={14} />
              </button>
              {voiceMode === "transcribing" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{
                    boxShadow: `0 0 0 0 ${BRAND_GREEN}`,
                    animation: "relay-pulse-ok 1800ms ease-in-out infinite",
                  }}
                />
              )}
            </div>

            {/* Voice-recording */}
            <button
              type="button"
              disabled={disabled || voiceMode === "transcribing"}
              onClick={voiceMode === "recording" ? stopRecording : () => void startRecording()}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
              style={{
                color: voiceMode === "recording" ? "#fff" : "var(--text-muted)",
                backgroundColor: voiceMode === "recording" ? "var(--accent-red)" : "transparent",
              }}
              title={voiceMode === "recording" ? "Stop & attach voice message" : "Record voice message"}
              aria-label="Record voice message"
              aria-pressed={voiceMode === "recording"}
            >
              {voiceMode === "recording" ? <Square size={12} /> : <AudioLines size={14} />}
            </button>
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
              // Plain Enter sends; Shift+Enter inserts newline. IME
              // composition (Japanese/Chinese/Korean input) gets a
              // pass — pressing Enter to commit a candidate shouldn't
              // accidentally fire the send.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-snug outline-none placeholder:opacity-60 disabled:opacity-60"
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
        Up to {formatBytes(MAX_BYTES)} per file · {MAX_FILES_PER_MESSAGE} files max · PDF, DOCX, XLSX, TXT, or images.
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
      ) : kind === "audio" ? (
        <span
          className="flex h-9 w-9 items-center justify-center rounded-md"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
          title="Voice message"
        >
          <Mic size={14} />
        </span>
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
