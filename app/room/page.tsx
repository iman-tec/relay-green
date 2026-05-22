import type { Metadata } from "next";
import { Suspense } from "react";
import { RoomClient } from "./RoomClient";

export const metadata: Metadata = {
  title: "Session — Relay.green",
  description: "Connect with a Relay engineer in real time.",
};

// RoomClient reads ?newchat / ?continueSessionId via useSearchParams() —
// Next.js 16 requires a Suspense boundary around any client component
// that does so. The fallback is intentionally minimal; RoomClient renders
// once auth resolves.
export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <RoomClient />
    </Suspense>
  );
}
