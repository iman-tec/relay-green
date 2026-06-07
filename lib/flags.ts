/*
 * Console feature flags (NEXT_PUBLIC_, build-time inlined, readable on server
 * and client). Each gates a reimagined console behind an off-by-default switch
 * so the existing surface is byte-identical until the flag is set.
 */

/** Enterprise + Department admin command centers (the /enterprise/v2 +
 *  /department/v2 bare-mode redesign). Off → today's StaffShell-embedded tabs. */
export function enterpriseV2Enabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ENTERPRISE_V2;
  return v === "1" || v === "true";
}
