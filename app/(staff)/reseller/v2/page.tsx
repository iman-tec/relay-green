import { redirect } from "next/navigation";

// The authed Channel Partner portal moved to /partner/v2 (consistent with the
// /partner login surface). Keep this redirect so old links + bookmarks land on
// the new home rather than 404.
export default function ResellerV2Redirect() {
  redirect("/partner/v2");
}
