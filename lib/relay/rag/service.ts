/*
 * Service-role Supabase client for RAG (indexing + history persistence).
 * Kept separate from indexer.ts so lightweight consumers (project-qa) don't
 * transitively pull in the PDF/DOCX/xlsx parsers.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function ragServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"
    );
  return createClient(url, key, { auth: { persistSession: false } });
}
