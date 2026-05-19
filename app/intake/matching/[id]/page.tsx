import { redirect } from "next/navigation";

type Params = { id: string };

// Matching now happens as an overlay modal inside /room. Old links to
// /intake/matching/[id] (saved tabs, navigations from older builds) are
// redirected to /room?matching=<id> so the modal pops automatically.
export default async function MatchingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  redirect(`/room?matching=${id}`);
}
