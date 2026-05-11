import type { Metadata } from "next";
import { RoomClient } from "./RoomClient";

export const metadata: Metadata = {
  title: "Session — Relay.green",
  description: "Connect with a Relay engineer in real time.",
};

export default function RoomPage() {
  return <RoomClient />;
}
