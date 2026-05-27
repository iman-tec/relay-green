import type { Metadata } from "next";
import { SurfaceLoginPage } from "@/app/_components/login/SurfaceLoginPage";

export const metadata: Metadata = {
  title: "Enterprise sign in — Relay.green",
  description: "Sign in to your Relay.green enterprise or department account.",
};

export default async function BusinessLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ wrong_surface?: string }>;
}) {
  const sp = await searchParams;
  return (
    <SurfaceLoginPage
      surface="business"
      copy={{
        title: "Sign in to Relay",
        blurb: "Enter your business email — we'll send you an 8-digit code.",
      }}
      wrongSurfaceNotice={sp.wrong_surface === "1"}
    />
  );
}
