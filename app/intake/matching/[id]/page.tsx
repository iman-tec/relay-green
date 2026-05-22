import { MatchingClient } from "./MatchingClient";

type Params = { id: string };

export default async function MatchingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <MatchingClient intakeId={id} />;
}
