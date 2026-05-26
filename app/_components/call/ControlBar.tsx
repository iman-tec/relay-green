"use client";

import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, PhoneOff, MessageSquare } from "lucide-react";
import type { Participant } from "@/lib/video/useZoomCall";
import { ConnectionPill } from "./ConnectionPill";

type Props = {
  self: Participant | null;
  isHost: boolean;
  sharing: boolean;
  showChatToggle: boolean;
  chatOpen: boolean;
  networkQuality: "good" | "fair" | "poor" | "unknown";
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onToggleChat: () => void;
  onLeave: () => void;
};

const BTN_BASE =
  "inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:opacity-50";

function pillStyle(active: boolean): React.CSSProperties {
  return {
    borderColor: "var(--border)",
    background: active ? "var(--surface-raised)" : "var(--surface)",
    color: "var(--text)",
  };
}

export function ControlBar({
  self, isHost, sharing, showChatToggle, chatOpen, networkQuality,
  onToggleMic, onToggleCamera, onToggleShare, onToggleChat, onLeave,
}: Props) {
  const muted = !!self?.audio.muted;
  const camOff = !self?.video.on;

  return (
    <div
      className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <ConnectionPill quality={networkQuality} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BTN_BASE}
          style={pillStyle(!muted)}
          onClick={onToggleMic}
          aria-pressed={!muted}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        <button
          type="button"
          className={BTN_BASE}
          style={pillStyle(!camOff)}
          onClick={onToggleCamera}
          aria-pressed={!camOff}
          title={camOff ? "Start camera" : "Stop camera"}
        >
          {camOff ? <VideoOff size={16} /> : <Video size={16} />}
        </button>

        <button
          type="button"
          className={BTN_BASE}
          style={pillStyle(sharing)}
          onClick={onToggleShare}
          aria-pressed={sharing}
          title={sharing ? "Stop sharing" : "Share screen"}
        >
          {sharing ? <MonitorX size={16} /> : <MonitorUp size={16} />}
        </button>

        {showChatToggle && (
          <button
            type="button"
            className={BTN_BASE}
            style={pillStyle(chatOpen)}
            onClick={onToggleChat}
            aria-pressed={chatOpen}
            title={chatOpen ? "Hide chat" : "Show chat"}
          >
            <MessageSquare size={16} />
          </button>
        )}

        <button
          type="button"
          className={BTN_BASE}
          style={{ borderColor: "var(--risk)", background: "var(--risk)", color: "#fff" }}
          onClick={onLeave}
          title={isHost ? "End call for everyone" : "Leave call"}
        >
          <PhoneOff size={16} />
        </button>
      </div>

      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {isHost ? "Host" : "Guest"}
      </div>
    </div>
  );
}
