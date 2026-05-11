/*
 * /company/governance — permanent redirect to /company/about.
 *
 * Governance content was merged into the About page so visitors get the
 * full company story (intro + how we're built + governance breakdown) on
 * one screen. This route stays as a 308 so existing links keep working.
 */

import { permanentRedirect } from "next/navigation";

export default function GovernancePage(): never {
  permanentRedirect("/company/about");
}
