"use client";

/*
 * Billing — the company's prepaid wallet (balance + buy minutes) on top, with
 * billing history (plan summary, spend, transactions) below. One tab, two
 * sections, single scroll.
 */

import { WalletTab } from "./WalletTab";
import { BillingTab } from "./BillingTab";
import { TabBody } from "./_shared";

export function BillingWalletTab() {
  return (
    <TabBody>
      <WalletTab />
      <div className="my-8 border-t" style={{ borderColor: "var(--border)" }} />
      <BillingTab />
    </TabBody>
  );
}
