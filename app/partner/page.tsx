import type { Metadata } from "next";
import { SurfaceLoginPage } from "@/app/_components/login/SurfaceLoginPage";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";

export const metadata: Metadata = {
  title: "Channel Partner sign in — Relay.green",
  description: "Sign in to manage your Relay.green channel partner account.",
};

// Salesy proof panel — only shown when the partner program is live. Honest copy
// + a real marketing video; no fabricated stats. Server-rendered (the <video>
// is a plain element), so no client boundary needed.
function PartnerProof() {
  return (
    <>
      <video
        src="/relay-explainer-final-v5.mp4"
        controls
        preload="metadata"
        poster="/relay-explainer-v6-poster.jpg"
        className="w-full rounded-2xl border shadow-lg"
        style={{ borderColor: "var(--border)", aspectRatio: "16 / 10" }}
      />
      <p
        className="max-w-[15ch] font-serif text-[25px] leading-[1.25] font-semibold"
        style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
      >
        Resell senior engineering support your clients already need — on your
        margin.
      </p>
      <p
        className="max-w-sm text-[14px]"
        style={{ color: "var(--text-muted)" }}
      >
        Onboard a company in two fields. Your discount applies automatically;
        your margin accrues as they use Relay.
      </p>
      <div className="flex items-center gap-4">
        <a
          href="mailto:partners@relay.green"
          className="rounded-lg border px-4 py-2 text-[13px] font-medium no-underline"
          style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
        >
          Talk to our team
        </a>
        <a
          href="/partner/apply"
          className="text-[13px] font-medium no-underline"
          style={{ color: "var(--primary-hover)" }}
        >
          Apply to become a partner →
        </a>
      </div>
    </>
  );
}

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
      aside={partnerProgramEnabled() ? <PartnerProof /> : undefined}
    />
  );
}
