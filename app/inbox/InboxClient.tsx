"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, PhoneIncoming, Loader2 } from "lucide-react";
import { useEngineerWorkspace } from "@/lib/relay/useEngineerWorkspace";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER_SOFT = "rgba(198, 102, 69, 0.14)";
const URGENT_AMBER = "#c66645";

export function InboxClient() {
  const router = useRouter();
  const { queue, recent, myActive, loading, error, takeNext, claim } = useEngineerWorkspace();
  const [tab, setTab] = useState<"people" | "chats">("people");
  const [search, setSearch] = useState("");

  // Build a "people" list — distinct customers across recent + queue, sorted by activity.
  const people = useMemo(() => {
    const all = [...queue, ...myActive, ...recent];
    const byEmail = new Map<string, { email: string; name: string; sessions: GuestCall[] }>();
    for (const c of all) {
      const k = c.guest_email ?? c.guest_name;
      if (!k) continue;
      const e = byEmail.get(k);
      if (e) e.sessions.push(c);
      else byEmail.set(k, { email: c.guest_email ?? "", name: c.guest_name, sessions: [c] });
    }
    return Array.from(byEmail.values())
      .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const am = Math.max(...a.sessions.map((s) => new Date(s.created_at).getTime()));
        const bm = Math.max(...b.sessions.map((s) => new Date(s.created_at).getTime()));
        return bm - am;
      });
  }, [queue, recent, myActive, search]);

  const handleTakeNext = async () => {
    const claimed = await takeNext();
    if (claimed) router.push(`/staff/session/${claimed.id}`);
  };

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[280px_1fr_320px]">
      {/* Left — People / Chats */}
      <aside
        className="flex flex-col border-r"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div className="flex gap-1 border-b p-3" style={{ borderColor: "var(--border)" }}>
          {(["people", "chats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm capitalize transition-colors"
              style={{
                backgroundColor: tab === t ? BRAND_GREEN_SOFT : "transparent",
                color: tab === t ? BRAND_GREEN : "var(--text-muted)",
                fontWeight: tab === t ? 600 : 500,
              }}
            >
              {t}
              {t === "chats" && queue.length > 0 && (
                <span
                  className="flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                  style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
                >
                  {queue.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="border-b p-3" style={{ borderColor: "var(--border)" }}>
          <div
            className="flex items-center gap-2 rounded-md border px-3 py-2"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
          >
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab}…`}
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: "var(--text)" }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "people" ? (
            people.length === 0 ? (
              <EmptyHint text="No people yet — sessions will populate this list." />
            ) : (
              people.map((p) => (
                <button
                  key={p.email + p.name}
                  className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => {
                    const live = p.sessions.find((s) => ["assigned","joining","live","grace"].includes(s.status));
                    if (live) router.push(`/staff/session/${live.id}`);
                  }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                    style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                  >
                    {(p.name || "?")[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{p.name}</span>
                      {p.sessions.some((s) => s.status === "queued") && (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: URGENT_AMBER }} />
                      )}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.sessions.length} session{p.sessions.length !== 1 ? "s" : ""} · {p.email}
                    </div>
                  </div>
                </button>
              ))
            )
          ) : (
            // Chats tab — show queued sessions as actionable list
            queue.length === 0 ? (
              <EmptyHint text="No customers waiting. Watch this space." />
            ) : (
              queue.map((s) => (
                <button
                  key={s.id}
                  onClick={async () => {
                    const c = await claim(s.id);
                    if (c) router.push(`/staff/session/${c.id}`);
                  }}
                  className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                    style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
                  >
                    {(s.guest_name || "?")[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.guest_name}</span>
                      {s.urgency !== "normal" && (
                        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}>
                          {s.urgency}
                        </span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Waiting · click to claim
                    </div>
                  </div>
                </button>
              ))
            )
          )}
        </div>
      </aside>

      {/* Center — Welcome / take next */}
      <section
        className="flex items-center justify-center"
        style={{ backgroundColor: "var(--background)" }}
      >
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2">
            <div
              className="rounded-md border px-4 py-2 text-sm"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
                color: "var(--accent-red)",
              }}
            >
              {error}
            </div>
          </div>
        )}
        {loading ? (
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
        ) : (
          <div className="flex max-w-md flex-col items-center gap-5 px-6 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            >
              <Sparkles size={26} />
            </div>
            <div>
              <h2 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
                Welcome back
              </h2>
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                {queue.length === 0
                  ? "No customers waiting right now."
                  : `${queue.length} guest${queue.length === 1 ? "" : "s"} waiting — pick one from the left to start.`}
              </p>
            </div>
            {queue.length > 0 && (
              <button
                onClick={handleTakeNext}
                className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
              >
                <PhoneIncoming size={14} />
                Take next waiting call
              </button>
            )}
          </div>
        )}
      </section>

      {/* Right — Call log */}
      <aside
        className="flex flex-col border-l"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            Call log
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {recent.length} recent calls
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {recent.length === 0 ? (
            <EmptyHint text="No calls yet." />
          ) : (
            recent.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/staff/session/${c.id}`)}
                className="flex w-full items-center justify-between gap-2 border-b px-5 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{c.guest_name}</div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {new Date(c.created_at).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>{text}</p>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = status === "live"
    ? { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN }
    : status === "queued" || status === "assigned" || status === "joining"
    ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : { bg: "color-mix(in srgb, var(--text) 8%, transparent)", fg: "var(--text-muted)" };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {status}
    </span>
  );
}
