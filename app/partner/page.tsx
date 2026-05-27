import type { Metadata } from "next";
import { SurfaceLoginPage } from "@/app/_components/login/SurfaceLoginPage";

export const metadata: Metadata = {
  title: "Channel Partner sign in — Relay.green",
  description: "Sign in to manage your Relay.green channel partner account.",
};

export default async function PartnerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ wrong_surface?: string }>;
}) {
  const sp = await searchParams;
  return (
    <SurfaceLoginPage
      surface="partner"
      copy={{
        title: "Sign in to Relay",
        blurb: "Enter your partner email — we'll send you an 8-digit code.",
      }}
      wrongSurfaceNotice={sp.wrong_surface === "1"}
    />
  );
}
