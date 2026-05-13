import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/app/_components/Wordmark";
import { StaffLoginForm } from "./StaffLoginForm";

export const metadata: Metadata = {
  title: "Staff sign in — Relay.green",
  description: "Sign in to Relay.green. Enter your work email — we'll send a 6-digit code.",
};

export default function StaffLoginPage() {
  const devMode = process.env.NODE_ENV === "development";

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ backgroundColor: "var(--background)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-8 shadow-sm"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="no-underline">
            <Wordmark size="lg" />
          </Link>
          <div className="flex flex-col gap-1.5">
            <h1
              className="text-xl font-semibold"
              style={{ color: "var(--text)" }}
            >
              Sign in to Relay
            </h1>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              Enter your work email — we&apos;ll send you a 6-digit code.
            </p>
          </div>
        </div>

        <Suspense fallback={<div className="h-44" />}>
          <StaffLoginForm devMode={devMode} />
        </Suspense>

        <div
          className="my-6 border-t"
          style={{ borderColor: "var(--border)" }}
        />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Are you a customer?{" "}
            <Link
              href="/login"
              className="underline-offset-3 hover:underline"
              style={{ color: "var(--text)" }}
            >
              Sign in here
            </Link>
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Not invited yet?{" "}
            <a
              href="mailto:support@relay.green"
              className="underline-offset-3 hover:underline"
              style={{ color: "var(--text)" }}
            >
              support@relay.green
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
