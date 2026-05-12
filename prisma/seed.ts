/*
 * Relay.green demo data seed (RG-0102).
 *
 * Seeds one of each persona, an enterprise organization with code and wallet,
 * an engineer profile + skills + compensation, a sample customer project,
 * a sample HourBucket and SupportSession in CLOSED state with a billing
 * record and ledger entry. Idempotent: running twice upserts deterministic
 * fixed-id rows.
 *
 * Run with: npm run db:seed (after `npm run db:push` once the database is up).
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding Relay.green demo data...");

  // Organization (Acme Inc — sample enterprise customer)
  const org = await prisma.organization.upsert({
    where: { id: "org_acme" },
    update: {},
    create: {
      id: "org_acme",
      name: "Acme Inc",
      primaryDomain: "acme.example",
      defaultBillingMode: "WALLET",
    },
  });

  // Organization code (used by Acme employees to register)
  await prisma.organizationCode.upsert({
    where: { id: "code_acme_2026" },
    update: {},
    create: {
      id: "code_acme_2026",
      organizationId: org.id,
      code: "ACME-2026",
      discountType: "PERCENTAGE",
      discountValue: 10,
      maxUsers: 200,
    },
  });

  // Enterprise wallet
  await prisma.enterpriseWallet.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      balanceAmount: 5000,
      currency: "EUR",
      lowBalanceThreshold: 500,
    },
  });

  // 5 personas — one of each role
  const customer = await prisma.user.upsert({
    where: { email: "anita@acme.example" },
    update: {},
    create: {
      id: "user_customer_anita",
      email: "anita@acme.example",
      displayName: "Anita F.",
      role: "CUSTOMER",
      status: "ACTIVE",
      organizationId: org.id,
    },
  });

  const engineerUser = await prisma.user.upsert({
    where: { email: "priya.engineer@relay.green" },
    update: {},
    create: {
      id: "user_engineer_priya",
      email: "priya.engineer@relay.green",
      displayName: "Priya Ramachandran",
      role: "ENGINEER",
      status: "ACTIVE",
    },
  });

  const supervisor = await prisma.user.upsert({
    where: { email: "raj.supervisor@relay.green" },
    update: {},
    create: {
      id: "user_supervisor_raj",
      email: "raj.supervisor@relay.green",
      displayName: "Raj K.",
      role: "SUPERVISOR",
      status: "ACTIVE",
    },
  });

  const enterpriseAdmin = await prisma.user.upsert({
    where: { email: "isabel@acme.example" },
    update: {},
    create: {
      id: "user_enterprise_isabel",
      email: "isabel@acme.example",
      displayName: "Isabel R.",
      role: "ENTERPRISE_ADMIN",
      status: "ACTIVE",
      organizationId: org.id,
    },
  });

  const internalAdmin = await prisma.user.upsert({
    where: { email: "ops@relay.green" },
    update: {},
    create: {
      id: "user_internal_ops",
      email: "ops@relay.green",
      displayName: "Ops Admin",
      role: "INTERNAL_ADMIN",
      status: "ACTIVE",
    },
  });

  // Engineer profile (alias-only customer-facing identity)
  const engineerProfile = await prisma.engineerProfile.upsert({
    where: { userId: engineerUser.id },
    update: {},
    create: {
      id: "eng_profile_priya",
      userId: engineerUser.id,
      aliasName: "Priya R.",
      avatarUrl: null,
      bioSummary: "Frontend & deploy specialist. Lovable, Cursor, Vercel.",
      languages: ["en"],
      timezone: "Asia/Kolkata",
      status: "AVAILABLE",
      supervisorId: supervisor.id,
      isExternal: false,
      customerVisible: true,
    },
  });

  // Engineer skills — 3 verified skills aligned with the I2 taxonomy
  const skillsToSeed = [
    {
      skillType: "AI_TOOL" as const,
      skillName: "Lovable",
      proficiency: "EXPERT" as const,
    },
    {
      skillType: "AI_TOOL" as const,
      skillName: "Cursor",
      proficiency: "PROFICIENT" as const,
    },
    {
      skillType: "FUNCTIONAL_EXPERTISE" as const,
      skillName: "Deployment / DNS / SSL / going-live",
      proficiency: "EXPERT" as const,
    },
    {
      skillType: "TECHNOLOGY" as const,
      skillName: "Next.js",
      proficiency: "EXPERT" as const,
    },
    {
      skillType: "TECHNOLOGY" as const,
      skillName: "Stripe",
      proficiency: "PROFICIENT" as const,
    },
  ];
  for (const skill of skillsToSeed) {
    await prisma.engineerSkill.upsert({
      where: {
        engineerProfileId_skillType_skillName: {
          engineerProfileId: engineerProfile.id,
          skillType: skill.skillType,
          skillName: skill.skillName,
        },
      },
      update: { verified: true },
      create: {
        engineerProfileId: engineerProfile.id,
        ...skill,
        verified: true,
      },
    });
  }

  // Engineer compensation — Gateway-salaried, 3% bonus default
  await prisma.engineerCompensationProfile.upsert({
    where: { engineerProfileId: engineerProfile.id },
    update: {},
    create: {
      engineerProfileId: engineerProfile.id,
      employmentType: "GATEWAY_SALARIED",
      bonusPercentage: 3,
      paymentCurrency: "INR",
      payrollVendor: "gateway-internal",
    },
  });

  // Sample customer project
  const project = await prisma.project.upsert({
    where: { id: "proj_acme_storefront" },
    update: {},
    create: {
      id: "proj_acme_storefront",
      customerId: customer.id,
      organizationId: org.id,
      name: "Acme storefront on Lovable",
      description: "B2B storefront prototype, Stripe checkout, 50 SKUs",
      aiToolTrack: "Lovable",
      productType: "Web app",
      techStack: { framework: "next", db: "supabase", payments: "stripe" },
      status: "ACTIVE",
    },
  });

  // Sample HourBucket — Anita has a 5-hour Stuck bucket, partly used
  const stuckBucket = await prisma.hourBucket.upsert({
    where: { id: "bucket_anita_stuck_5" },
    update: {},
    create: {
      id: "bucket_anita_stuck_5",
      customerId: customer.id,
      organizationId: org.id,
      engagementType: "STUCK",
      bucketSize: 5,
      pricePaid: 195,
      currency: "EUR",
      effectiveRatePerHour: 39,
      hoursRemaining: 4.5,
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: "ACTIVE",
      stripePaymentIntentId: "pi_demo_anita_stuck",
      refundEligibility: "FULL",
    },
  });

  // Sample closed SupportSession — 30 minutes used, billed at €19.50
  const session = await prisma.supportSession.upsert({
    where: { id: "session_anita_lovable_stripe" },
    update: {},
    create: {
      id: "session_anita_lovable_stripe",
      customerId: customer.id,
      projectId: project.id,
      organizationId: org.id,
      engineerProfileId: engineerProfile.id,
      supervisorId: supervisor.id,
      status: "CLOSED",
      aiToolTrack: "Lovable",
      productType: "Web app",
      issueType: "Connecting another tool",
      functionalExpertiseNeeded: "Payments",
      urgency: "Right now",
      language: "en",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      engineerJoinedAt: new Date(Date.now() - 60 * 60 * 1000 + 45 * 1000),
      endedAt: new Date(Date.now() - 30 * 60 * 1000),
      freeTrialApplied: true,
      paidStartedAt: new Date(Date.now() - 50 * 60 * 1000),
      billableMinutes: 30,
      totalAmount: 19.5,
      currency: "EUR",
      billingStatus: "BILLED",
    },
  });

  // Ledger entry for the 30 minutes drawn down
  await prisma.hourLedgerEntry.upsert({
    where: { id: "ledger_anita_session1_drawdown" },
    update: {},
    create: {
      id: "ledger_anita_session1_drawdown",
      hourBucketId: stuckBucket.id,
      sessionId: session.id,
      customerId: customer.id,
      engineerProfileId: engineerProfile.id,
      minutesDrawn: 30,
      ratePerHour: 39,
      amountDrawn: 19.5,
      entryType: "DRAWDOWN",
    },
  });

  // Billing record for the closed session
  await prisma.billingRecord.upsert({
    where: { sessionId: session.id },
    update: {},
    create: {
      sessionId: session.id,
      customerId: customer.id,
      organizationId: org.id,
      hourBucketId: stuckBucket.id,
      billingSource: "ENTERPRISE_WALLET",
      ratePerHour: 39,
      currency: "EUR",
      freeMinutesApplied: 10,
      billableMinutes: 30,
      subtotal: 19.5,
      discountAmount: 0,
      taxAmount: 0,
      total: 19.5,
      status: "BILLED",
    },
  });

  // Audit log entry
  await prisma.auditLog.create({
    data: {
      actorUserId: internalAdmin.id,
      action: "DEMO_DATA_SEEDED",
      entityType: "Database",
      entityId: "seed",
      metadata: {
        seededPersonas: 5,
        seededOrgs: 1,
        seededEngineerProfiles: 1,
        seededProjects: 1,
        seededBuckets: 1,
        seededSessions: 1,
      },
    },
  });

  console.log("Seed complete:");
  console.log(`  customer:         ${customer.email}`);
  console.log(`  engineer:         ${engineerUser.email} (alias: Priya R.)`);
  console.log(`  supervisor:       ${supervisor.email}`);
  console.log(`  enterprise admin: ${enterpriseAdmin.email} (Acme Inc)`);
  console.log(`  internal admin:   ${internalAdmin.email}`);
  console.log(`  organization:     ${org.name}`);
  console.log(`  org code:         ACME-2026 (10% discount)`);
  console.log(`  project:          ${project.name}`);
  console.log(`  hour bucket:      Stuck 5hr (4.5hr remaining)`);
  console.log(`  session:          1 CLOSED session, 30 min billed at €19.50`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
