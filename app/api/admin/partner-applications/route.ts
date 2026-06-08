/*
 * GET /api/admin/partner-applications — the super-admin review queue.
 *
 * Returns every partner application, newest first, with a `duplicate` flag set
 * on any row that shares a work_email (or company_name) with an EARLIER row —
 * so repeats are visible in the queue, not silently merged (brief: flag, don't
 * dedupe). Super-admin only.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { flagDuplicateApplications } from "@/lib/partner/flagDuplicateApplications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AppRow = {
  id: string;
  contact_name: string;
  work_email: string;
  company_name: string;
  company_website: string;
  country_region: string;
  clients_text: string;
  heard_about: string | null;
  anything_else: string | null;
  source: string;
  status: string;
  reseller_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { data, error } = await admin
    .from("partner_applications")
    .select(
      "id, contact_name, work_email, company_name, company_website, country_region, clients_text, heard_about, anything_else, source, status, reseller_id, reviewed_by, reviewed_at, created_at"
    )
    .order("created_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as AppRow[];

  // Flag rows that repeat an earlier email/company (reviewer signal; never
  // blocks). Shared with the unit tests via flagDuplicateApplications.
  const dupIds = flagDuplicateApplications(
    rows.map((r) => ({
      id: r.id,
      workEmail: r.work_email,
      companyName: r.company_name,
      createdAt: r.created_at,
    }))
  );

  return NextResponse.json({
    applications: rows.map((r) => ({
      id: r.id,
      contactName: r.contact_name,
      workEmail: r.work_email,
      companyName: r.company_name,
      companyWebsite: r.company_website,
      countryRegion: r.country_region,
      clientsText: r.clients_text,
      heardAbout: r.heard_about,
      anythingElse: r.anything_else,
      source: r.source,
      status: r.status,
      resellerId: r.reseller_id,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
      duplicate: dupIds.has(r.id),
    })),
  });
}
