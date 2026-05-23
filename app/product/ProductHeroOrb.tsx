"use client";

import { useTryRelay } from "../_marketing/TryRelayProvider";

export function ProductHeroOrb() {
  const { open } = useTryRelay();

  return (
    <button
      type="button"
      className="r-green-sphere"
      aria-label="Press the dot to start a Relay session"
      onClick={open}
      style={{
        width: 96,
        height: 96,
        borderRadius: 999,
        border: 0,
        padding: 0,
        cursor: "pointer",
        background:
          "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 38%), radial-gradient(circle at 70% 78%, rgba(20,30,15,0.28) 0%, rgba(20,30,15,0) 55%), radial-gradient(circle at 50% 50%, #4d6b40 35%, #3f5c34 95%)",
        boxShadow:
          "0 22px 36px rgba(58,82,48,0.32), 0 6px 12px rgba(58,82,48,0.22), inset 0 -8px 16px rgba(20,30,15,0.22), inset 0 8px 16px rgba(255,255,255,0.10)",
        display: "inline-block",
      }}
    />
  );
}
