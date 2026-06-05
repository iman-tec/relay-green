"use client";

/*
 * Dedicated full-viewport call view.
 *
 * Renders ONLY the Zoom embed at full screen plus a floating "End call"
 * button. No sidebar, no chat, no Relay chrome — by design. Both customer
 * and engineer land here when their session goes live; chat history and
 * post-call review live back at /room or /staff/session/[id] after the call
 * ends.
 *
 * Role detection is implicit: `useEngineerSession` exposes the same session
 * row to anyone with RLS access, and its `isAssignedEngineer` flag tells us
 * whether the viewer is the engineer (role=1, host) or anyone else (role=0,
 * attendee — which for a 1:1 call is the customer).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PhoneOff } from "lucide-react";
import { ZoomCall as ZoomEmbed } from "@/app/_components/ZoomCall";
import { useEngineerSession } from "@/lib/relay/useEngineerSession";
import { useIsSupervisor } from "@/lib/relay/useIsSupervisor";
import { createClient } from "@/lib/supabase/browser";

type Viewer = { name: string; email: string };

export function CallClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const state = useEngineerSession(sessionId);
  const isSupervisor = useIsSupervisor();
  const [viewer, setViewer] = useState<Viewer | null>(null);

  // Fetch the auth user for ZoomEmbed's userName / userEmail props.
  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      const name =
        (u.user_metadata?.full_name as string | undefined) ??
        (u.user_metadata?.name as string | undefined) ??
        u.email ??
        "Relay user";
      setViewer({ name, email: u.email ?? "" });
    });
  }, []);

  // Auto-navigate away when the session ends — the OTHER party may have
  // ended the call while we're still on this page.
  useEffect(() => {
    if (!state.session) return;
    const s = state.session.status;
    if (s === "ended" || s === "cancelled" || s === "abandoned") {
      router.replace(state.isAssignedEngineer ? "/dashboard" : "/room");
    }
  }, [state.session, state.isAssignedEngineer, router]);

  if (state.loading || !state.session || !viewer) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (!state.session.zoom_meeting_id) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-sm text-white/70">
          This session isn&apos;t active right now.
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          Go back
        </button>
      </div>
    );
  }

  const role: 0 | 1 = state.isAssignedEngineer ? 1 : 0;
  const fallbackJoinUrl =
    role === 1 ? state.session.zoom_start_url : state.session.zoom_join_url;

  const handleEnd = async () => {
    // Only the assigned engineer can end the session for everyone.
    // The customer leaves locally; the engineer terminates the call.
    if (state.isAssignedEngineer) {
      await state.end().catch(() => undefined);
    }
    router.replace(state.isAssignedEngineer ? "/dashboard" : "/room");
  };

  return (
    <div className="fixed inset-0 bg-black">
      <ZoomEmbed
        meetingNumber={state.session.zoom_meeting_id}
        userName={isSupervisor ? "Moderator" : viewer.name}
        userEmail={viewer.email}
        role={role}
        fallbackJoinUrl={fallbackJoinUrl}
        onLeave={() => {
          router.replace(state.isAssignedEngineer ? "/dashboard" : "/room");
        }}
      />
      <button
        type="button"
        onClick={() => void handleEnd()}
        className="fixed right-6 bottom-6 z-[60] inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-red-900/40 transition-colors hover:bg-red-700"
      >
        <PhoneOff size={16} />
        End call
      </button>
    </div>
  );
}
