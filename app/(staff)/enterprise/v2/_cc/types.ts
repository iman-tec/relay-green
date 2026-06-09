/* Types for the enterprise command center — mirror the existing
 * /api/enterprise/{me,departments,wallet} responses (reused, not rebuilt). */

export type EntMe = {
  org: {
    id: string;
    name: string;
    primaryDomain: string | null;
    status: string;
    enterpriseCode: string;
    discountPct: number;
    discountUntil: string | null;
    partnerStatus: string | null;
    retentionDays: number;
  };
  channelPartner: { name: string; discountPct: number } | null;
  kpis: {
    staffCount: number;
    userCount: number;
    sessions7Days: number;
    sessions30Days: number;
    activeIn7Days: number;
    liveNow: number;
    spendMonthCents: number;
    avgDurationMin: number;
  };
};

export type EntDepartment = {
  id: string;
  name: string;
  departmentCode: string;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  adminUserId: string | null;
  totalEmployees: number;
  activeEmployees: number;
  createdAt: string;
};

export type EntDepartments = {
  enterprise: {
    id: string;
    name: string;
    enterpriseCode: string;
    status: string;
    allocatedMinutes: number;
    usedMinutes: number;
    remainingMinutes: number;
  };
  departments: EntDepartment[];
};

export type EntWallet = {
  currency: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  distributedMinutes: number;
  perMinuteCents: number;
  bundles: {
    code: string;
    label: string;
    minutes: number;
    amountCents: number;
  }[];
};

export type EntTab =
  | "overview"
  | "recharge"
  | "finance"
  | "members"
  | "settings"
  | "resources";
