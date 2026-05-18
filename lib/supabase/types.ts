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
  // Pod ownership — stamped at claim time from the engineer's pod_members
  // row. NULL until claimed (queued) or for engineers with no pod assignment.
  // Drives /supervise scoping for pod_lead / ops_manager.
  pod_id: string | null;
  // Phase 4: project grouping. Both nullable for legacy / "General" sessions.
  project_id: string | null;
  project_name: string | null;
  // Summary state machine (replaces the "spinner if summary IS NULL" check).
  // See migration 20260518200000_summary_state.sql for the lifecycle.
  summary_state: SummaryState;
  summary_state_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SummaryState =
  | "idle"
  | "generating_session_summary"
  | "waiting_for_transcript"
  | "generating_zoom_summary"
  | "summary_ready"
  | "summary_failed"
  | "no_conversation"
  | "transcript_unavailable";

export type GuestMessageAttachment = {
  id:          string;
  message_id:  string;
  path:        string;
  name:        string;
  mime:        string;
  size_bytes:  number;
  kind:        "image" | "document";
  created_at:  string;
};

export type GuestMessage = {
  id: string;
  guest_call_id: string;
  sender_kind: "guest" | "engineer" | "system";
  sender_id: string | null;
  sender_name: string | null;
  /** Now nullable: an attachment-only message has no body. */
  body: string | null;
  created_at: string;
  /**
   * 'all' (default) renders for everyone who can read the chat.
   * 'supervisor' renders only when the viewer holds a pod_lead / ops_manager
   *  / admin / super_admin role — used for e.g. Zoom recording URLs that
   *  should stay out of the customer/engineer-facing timeline.
   */
  visibility?: "all" | "supervisor";
  /** Populated by the join on guest_message_attachments. */
  attachments?: GuestMessageAttachment[];
};
