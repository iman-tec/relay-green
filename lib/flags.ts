/*
 * Console feature flags (NEXT_PUBLIC_, build-time inlined, readable on server
 * and client). Each gates a reimagined console behind an off-by-default switch
 * so the existing surface is byte-identical until the flag is set.
 */

/** Enterprise + Department admin command centers (the /enterprise/v2 +
 *  /department/v2 bare-mode redesign). Off → today's StaffShell-embedded tabs. */
// LAUNCHED: on by default. Kill-switch — set NEXT_PUBLIC_ENTERPRISE_V2=0
// (or "false") to disable in an environment without a code change.
export function enterpriseV2Enabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ENTERPRISE_V2;
  return v !== "0" && v !== "false";
}
