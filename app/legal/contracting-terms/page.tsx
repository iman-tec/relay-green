/*
 * General Terms & Conditions for contracting (go-live / maintenance bids).
 * Placeholder content — legal will replace the body. Printable: the customer
 * opens this alongside the estimate and can Print → Save as PDF. The bid's
 * terms_url points here by default.
 */

export const metadata = { title: "Contracting Terms & Conditions · Relay" };

export default function ContractingTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12" style={{ color: "var(--text)" }}>
      <h1 className="font-serif text-3xl font-medium">Relay — General Terms &amp; Conditions for Contracting</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        These general terms apply to go-live and maintenance/enhancement engagements
        contracted through Relay. (Placeholder — to be finalized by legal.)
      </p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed" style={{ color: "var(--text)" }}>
        <Section n="1" title="Scope of work">
          The engagement covers the scope set out in the accompanying estimate. Work
          outside that scope is quoted separately.
        </Section>
        <Section n="2" title="Fees & payment">
          Fees are as stated in the estimate and are payable to commence work. Relay
          is engaged on a per-engagement basis; no subscription is implied.
        </Section>
        <Section n="3" title="Timeline">
          Timelines in the estimate are good-faith estimates and may shift with scope
          changes or dependencies outside Relay's control.
        </Section>
        <Section n="4" title="Intellectual property">
          On full payment, deliverables produced for the engagement transfer to the
          customer, excluding Relay's pre-existing tooling and general know-how.
        </Section>
        <Section n="5" title="Confidentiality">
          Each party keeps the other's non-public information confidential and uses it
          only for the engagement.
        </Section>
        <Section n="6" title="Liability">
          Relay's aggregate liability is limited to the fees paid for the engagement.
          Neither party is liable for indirect or consequential loss.
        </Section>
        <Section n="7" title="Termination">
          Either party may end the engagement on written notice; the customer pays for
          work performed up to termination.
        </Section>
        <Section n="8" title="Governing law">
          These terms are governed by the laws stated in the customer's order or, absent
          that, Relay's place of business.
        </Section>
      </div>

      <p className="mt-10 text-xs" style={{ color: "var(--text-faint)" }}>
        Placeholder document. The binding terms are those issued by Relay's legal team
        with your estimate.
      </p>
    </main>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold">{n}. {title}</h2>
      <p className="mt-1" style={{ color: "var(--text-muted)" }}>{children}</p>
    </section>
  );
}
