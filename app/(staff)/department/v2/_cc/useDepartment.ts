"use client";

/* Department command-center data: /api/department/employees (dept + employees),
 * polled (interval + tab-focus) so spend/minutes update live. Read-only. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeptData } from "./types";

const POLL_MS = 20_000;

export function useDepartment() {
  const [data, setData] = useState<DeptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/department/employees", { cache: "no-store" });
      if (!r.ok) throw new Error("Couldn't load your department.");
      setData((await r.json()) as DeptData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

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

  return { data, loading, error, refetch: load };
}
