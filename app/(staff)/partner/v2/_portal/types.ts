/* Shared types for the Channel Partner command center — mirror the
 * GET /api/reseller/portal payload (app/api/reseller/portal/route.ts). */

export type PartnerStatus = "invited" | "active" | "paused" | null;

export type PortalCompany = {
  id: string;
  name: string;
  code: string;
  partnerStatus: PartnerStatus;
  status: string;
  discountPct: number;
  minutesThisMonth: number;
  minutesLifetime: number;
  spendThisMonthCents: number;
  spendLifetimeCents: number;
  earnedLifetimeCents: number;
  onboardedAt: string | null;
  lastActivityAt: string | null;
  adminName: string | null;
  adminEmail: string | null;
};

export type PortalPayload = {
  reseller: {
    id: string;
    name: string;
    code: string;
    tier: string;
    commission: number;
    defaultPassthroughPct: number;
  };
  ribbon: {
    totalCompanies: number;
    activeCompanies: number;
    minutesThisMonth: number;
    minutesLifetime: number;
    spendThisMonthCents: number;
    spendLifetimeCents: number;
    balanceDueCents: number;
    earnedLifetimeCents: number;
    paidLifetimeCents: number;
  };
  companies: PortalCompany[];
};

export type PortalTab =
  | "overview"
  | "onboard"
  | "referrals"
  | "program"
  | "resources"
  | "settings"
  | "help";
