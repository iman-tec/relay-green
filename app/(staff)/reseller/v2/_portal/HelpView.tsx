"use client";

/* Help — short, honest orientation. Not a knowledge-base dump. */

export function HelpView() {
  return (
    <div className="mx-auto max-w-[680px] px-10 py-9">
      <h1
        className="mb-7 font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Help
      </h1>
      <div className="flex flex-col gap-6">
        <Item title="How onboarding works">
          You add a company with its name and an admin email. We send the admin
          a branded invite; once they accept the terms, the company goes Active
          and your discount applies to their usage automatically.
        </Item>
        <Item title="How your margin works">
          Relay gives you a wholesale discount off list. You choose how much to
          pass through to each company. Your margin is the difference, accrued
          on their billed usage. It shows as Earned, with Balance due = Earned −
          Paid out.
        </Item>
        <Item title="Tiers">
          Two tiers, gated on your monthly book spend. Hit the Premier threshold
          and your wholesale rate increases. Track progress on the Program page.
        </Item>
        <Item title="Talk to us">
          Your partner manager is one email away —{" "}
          <a
            href="mailto:partners@relay.green"
            className="font-medium underline"
            style={{ color: "var(--primary-hover)" }}
          >
            partners@relay.green
          </a>
          .
        </Item>
      </div>
    </div>
  );
}

function Item({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
      <h2 className="mb-1.5 text-[15px] font-semibold">{title}</h2>
      <p
        className="text-[14px] leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        {children}
      </p>
    </div>
  );
}
