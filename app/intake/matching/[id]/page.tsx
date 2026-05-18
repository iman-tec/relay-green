import type { Metadata } from "next";
import { MatchingClient } from "./MatchingClient";

export const metadata: Metadata = {
  title: "Finding your engineer — Relay.green",
};

type Params = { id: string };

export default async function MatchingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  return <MatchingClient intakeId={id} />;
}
