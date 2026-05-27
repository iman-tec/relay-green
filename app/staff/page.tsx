import type { Metadata } from "next";
import { SurfaceLoginPage } from "@/app/_components/login/SurfaceLoginPage";

export const metadata: Metadata = {
  title: "Staff sign in — Relay.green",
  description: "Sign in to Relay.green. Engineers, supervisors and platform admins.",
};

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ wrong_surface?: string }>;
}) {
  const sp = await searchParams;
  return (
    <SurfaceLoginPage
      surface="staff"
      copy={{
        title: "Sign in to Relay",
        blurb: "Enter your work email — we'll send you an 8-digit code.",
      }}
      showDevQuickPick
      wrongSurfaceNotice={sp.wrong_surface === "1"}
    />
  );
}
