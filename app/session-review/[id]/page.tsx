import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SessionReviewClient } from "./SessionReviewClient";

export const dynamic = "force-dynamic";

/*
 * Read-only post-call review page — meant to be the SAME surface for both
 * the engineer (navigated to from /inbox) and the customer (navigated to
 * from a past-session click in /room). Shows:
 *
 *   • Header with customer, engineer alias, project, date, duration
 *   • AI summary block (overview + next steps)
 *   • Files list (attachments grouped by kind, each with a download link)
 *   • Chat transcript (read-only message timeline, with .txt download)
 *
 * Deliberately outside the (staff) route group so it doesn't pull in the
 * staff shell — customers signing in won't be allowed past the staff
 * guard, but they should still reach this page. RLS on guest_calls /
 * guest_messages / chat_attachments handles per-row access (customer sees
 * own, engineer sees own claims, supervisor sees pod scope, super_admin
 * sees everything).
 */
export default async function SessionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/staff");

  const { data: session } = await sb
    .from("guest_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!session) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div className="max-w-sm text-center">
          <h2
            className="mb-2 text-lg font-semibold"
            style={{ color: "var(--text)" }}
          >
            Session not found
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            It may have been deleted, or you don&apos;t have access. Try going
            back to your inbox.
          </p>
        </div>
      </div>
    );
  }

  return <SessionReviewClient sessionId={id} initialSession={session} />;
}
