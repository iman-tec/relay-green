"use client";

/*
 * GlobalNewChatModal — the "New chat" popup (master-prompt §1.4).
 *
 * Asks "What would you like to chat about?" and offers:
 *   - a pill per existing project → starts a new session in that project
 *     (follows §1.3: opens the chat and rings an engineer)
 *   - "+ Add new project" → the intake flow (§1.1 / §1.2)
 *   - a quiet fallback to leave an async message instead (Relay's existing
 *     no-ring path), so that capability isn't lost
 *
 * Pure presentation: all the real work (session mint, ring, navigation)
 * stays in RoomClient via the callbacks.
 */

import { FolderPlus, MessageSquarePlus } from "lucide-react";
import { Button, Chip, Modal } from "@/app/_components/ui";

export function GlobalNewChatModal({
  open,
  onClose,
  projects,
  onPickProject,
  onAddProject,
  onAsyncChat,
}: {
  open: boolean;
  onClose: () => void;
  projects: { id: string; name: string }[];
  onPickProject: (projectId: string) => void;
  onAddProject: () => void;
  onAsyncChat?: () => void;
}) {
  const hasProjects = projects.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New chat"
      description="What would you like to chat about?"
      size="md"
    >
      <div className="flex flex-col gap-5">
        {hasProjects ? (
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-medium text-[var(--text)]">
              Select a project to chat about
            </span>
            <div className="flex flex-wrap gap-2.5">
              {projects.map((p) => (
                <Chip key={p.id} onClick={() => onPickProject(p.id)}>
                  {p.name}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              We&apos;ll open the chat and ring an engineer who fits the project.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            You don&apos;t have any projects yet. Add one to get started.
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
          <Button
            variant={hasProjects ? "secondary" : "primary"}
            full
            iconLeft={<FolderPlus className="size-4" />}
            onClick={onAddProject}
          >
            Add new project
          </Button>

          {onAsyncChat && (
            <button
              type="button"
              onClick={onAsyncChat}
              className="inline-flex items-center justify-center gap-1.5 rounded-full py-2 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              <MessageSquarePlus className="size-4" />
              Or just leave a message
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
