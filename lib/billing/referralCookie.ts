/*
 * Shared constant for the channel-partner referral first-touch cookie.
 *
 * Kept in its own tiny module (no heavy imports) so the edge proxy can import
 * it without pulling supabase-js into the edge bundle. The cookie is set by
 * proxy.ts when a visitor arrives with ?ref=<reseller_code> and read by the
 * signup flow (verify-otp) to attribute an organic individual to the partner.
 */
export const REF_COOKIE = "relay_ref";
