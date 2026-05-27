/*
 * Client-safe CSV/paste parser for the bulk invite entry point. No node
 * imports, so it's importable from client components.
 *
 * Accepts header or headerless rows. Recognized columns: email (required),
 * name, department, role, company / company_name.
 */

export interface ParsedRecipient {
  email: string;
  name?: string;
  department?: string;
  role?: string;
  companyName?: string;
}

export function parseCsvRecipients(text: string): { recipients: ParsedRecipient[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { recipients: [], errors };

  const first = lines[0].toLowerCase();
  const hasHeader = first.includes("email");
  const headers = hasHeader
    ? lines[0].split(",").map((h) => h.trim().toLowerCase())
    : ["email", "name", "department", "role"];
  const col = (h: string) => headers.indexOf(h);

  const out: ParsedRecipient[] = [];
  const seen = new Set<string>();
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = line.split(",").map((c) => c.trim());
    const emailRaw = col("email") >= 0 ? cells[col("email")] : cells[0];
    const email = (emailRaw ?? "").toLowerCase();
    if (!email || !email.includes("@")) { errors.push(`Skipped "${line}" — no valid email`); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name:        col("name") >= 0 ? cells[col("name")] || undefined : undefined,
      department:  col("department") >= 0 ? cells[col("department")] || undefined : undefined,
      role:        col("role") >= 0 ? cells[col("role")] || undefined : undefined,
      companyName: col("company") >= 0 ? cells[col("company")] || undefined
                 : col("company_name") >= 0 ? cells[col("company_name")] || undefined : undefined,
    });
  }
  return { recipients: out, errors };
}
