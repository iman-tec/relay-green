import type { Metadata } from "next";
import { Suspense } from "react";
import { SetPasswordClient } from "./SetPasswordClient";

export const metadata: Metadata = {
  title: "Set a password — Relay.green",
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <SetPasswordClient />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center text-sm"
      style={{ color: "var(--text-muted)" }}
    >
      Loading…
    </div>
  );
}
