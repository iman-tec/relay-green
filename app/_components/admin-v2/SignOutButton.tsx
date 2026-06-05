"use client";

/*
 * Sign-out button used in the /admin/v2 top bar. Same flow as the
 * legacy StaffShell: signOut() via the browser Supabase client, then
 * push to /staff.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      // Flip Offline before the session dies (no-op for non-engineers).
      try {
        await supabase.rpc("engineer_set_online", { _online: false });
      } catch {
        /* best-effort */
      }
      // Supervisors/super_admins go off duty too so coverage re-routes.
      try {
        await supabase.rpc("supervisor_set_online", { _online: false });
      } catch {
        /* best-effort */
      }
      await supabase.auth.signOut();
    } finally {
      router.push("/staff");
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    >
      <LogOut className="size-3.5" />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
