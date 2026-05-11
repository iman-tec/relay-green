/*
 * Hand-rolled types for the Supabase tables we touch.
 * Mirrors the migration contract — keep in sync.
 */

export type SessionStatus =
  | "queued"
  | "assigned"
  | "joining"
  | "live"
  | "grace"
  | "ending"
  | "ended"
  | "abandoned"
  | "cancelled"
  | "expired_free";

export type Urgency = "normal" | "urgent" | "critical";

export type GuestCall = {
  id: string;
  guest_name: string;
  guest_email: string | null;
  status: SessionStatus;
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  zoom_start_url: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  free_minutes: number;
  free_minutes_used: number | null;
  paid_extension_at: string | null;
  thread_id: string | null;
  agent_name: string | null;
  ai_summary_title: string | null;
  ai_summary_overview: string | null;
  ai_next_steps: unknown;
  summary: string | null;
  recording_play_url: string | null;
  duration_minutes: number | null;
  // Phase 1 additions
  recall_count: number;
  urgency: Urgency;
  assigned_at: string | null;
  joined_at: string | null;
  engineer_joined_at: string | null;
  customer_joined_at: string | null;
  customer_user_id: string | null;
  last_recall_at: string | null;
  abandoned_at: string | null;
  cancelled_at: string | null;
  free_expired_at: string | null;
  ended_reason: string | null;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GuestMessage = {
  id: string;
  guest_call_id: string;
  sender_kind: "guest" | "engineer" | "system";
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};
