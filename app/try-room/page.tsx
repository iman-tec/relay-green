/*
 * /try-room — no-auth guest landing for the Try-RELAY funnel.
 *
 * The marketing site funnel drops the customer here after they pick need /
 * stack / urgency and we surface a matched engineer. The page renders a
 * stripped-down "in-session" experience:
 *
 *   - Top: matched-engineer card (read from localStorage `relay-tryrelay-context`).
 *   - Below: an AI assistant chat (calls /api/assistant — OpenAI proxy) that
 *     captures additional context before a real engineer joins.
 *
 * No login is required. // TODO(auth): when the customer wants to keep their
 * thread, upsell a passwordless magic-link via Supabase signInWithOtp and
 * migrate the local chat into a real guest_calls row.
 */

import { TryRoomClient } from "./TryRoomClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return <TryRoomClient />;
}
