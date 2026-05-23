/*
 * /resources/research/economics-of-follow-the-sun-engineering
 *
 * Retired: the original piece argued cost-economics with named geographies,
 * which sits sideways to the brand voice ("press the dot, an engineer
 * joins", no wondering about who, where, or cost). Redirects to the
 * research sub-hub so any inbound link still resolves.
 */

import { redirect } from "next/navigation";

export default function RetiredArticle(): never {
  redirect("/resources/research");
}
