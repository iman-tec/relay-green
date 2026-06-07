"use client";

/*
 * Enterprise command-center data: me + departments + wallet, fetched together
 * and POLLED (interval + tab-focus) so the balance and spend update live as
 * sessions burn minutes — without touching the (non-functional) realtime layer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EntMe, EntDepartments, EntWallet } from "./types";

const POLL_MS = 20_000;

export function useEnterprise() {
  const [me, setMe] = useState<EntMe | null>(null);
  const [depts, setDepts] = useState<EntDepartments | null>(null);
  const [wallet, setWallet] = useState<EntWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [m, d, w] = await Promise.all([
        fetch("/api/enterprise/me", { cache: "no-store" }),
        fetch("/api/enterprise/departments", { cache: "no-store" }),
        fetch("/api/enterprise/wallet", { cache: "no-store" }),
      ]);
      if (!m.ok) throw new Error("Couldn't load your organization.");
      setMe((await m.json()) as EntMe);
      if (d.ok) setDepts((await d.json()) as EntDepartments);
      if (w.ok) setWallet((await w.json()) as EntWallet);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  const refetch = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return { me, depts, wallet, loading, error, refetch };
}
