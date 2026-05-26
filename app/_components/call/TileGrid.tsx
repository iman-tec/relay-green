"use client";

import { VideoTile } from "./VideoTile";
import type { Participant } from "@/lib/video/useZoomCall";

type Props = {
  self: Participant | null;
  participants: Participant[];
  client: any;
};

export function TileGrid({ self, participants, client }: Props) {
  // Include self at the front; SDK's getAllUser sometimes omits the local user.
  const all = self ? [self, ...participants.filter((p) => p.userId !== self.userId)] : participants;
  if (all.length === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        Waiting for participants…
      </div>
    );
  }
  return (
    <div
      className="grid h-full w-full gap-2 p-2"
      style={{
        gridTemplateColumns:
          all.length === 1 ? "1fr"
          : all.length === 2 ? "repeat(2, 1fr)"
          : "repeat(auto-fit, minmax(220px, 1fr))",
      }}
    >
      {all.map((p) => (
        <VideoTile key={p.userId} participant={p} client={client} />
      ))}
    </div>
  );
}
