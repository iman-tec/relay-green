"use client";

import { useTryRelay } from "./TryRelayProvider";

export function ProofDotButton() {
  const { open } = useTryRelay();

  return (
    <button
      type="button"
      className="r-proof-dot-button r-green-sphere"
      onClick={open}
      aria-label="Press the dot to start a Relay session"
    />
  );
}
