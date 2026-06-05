/*
 * Client-safe CSV/paste parser for the bulk invite entry point. No node
 * imports, so it's importable from client components.
 *
 * Two parsers:
 *   - parseCsvRecipients         — lenient. Accepts header or headerless rows.
 *                                  Used by the members variant of InviteFlow.
 *   - parseCompaniesCsvStrict    — strict. Header REQUIRED with exactly:
 *                                  email, name, company, discount, months.
 *                                  Per-row empty cells, non-numeric discount/
 *                                  months, and out-of-range values all
 *                                  produce errors that block sending. Used
 *                                  by the channel-partner "Bulk add (CSV)".
 */

export interface ParsedRecipient {
  email: string;
  name?: string;
  department?: string;
  role?: string;
  companyName?: string;
}

export interface ParsedCompaniesRecipient {
  email: string;
  name: string;
  companyName: string;
  discountPct: number;
  discountMonths: number;
}

export interface CompaniesParseResult {
  recipients: ParsedCompaniesRecipient[];
  /** Required headers absent from row 1. Empty when the header is complete. */
  missingColumns: string[];
  /** Per-row problems (missing cells, non-numeric values, out-of-range). */
  rowErrors: string[];
  /**
   * Non-blocking per-row notices. Currently emitted only when a row's
   * `discount` cell is empty — the row is still accepted with `discountPct=0`,
   * but the partner is told which company defaulted so they can correct it
   * before sending if they want.
   */
  rowWarnings: string[];
}

export function parseCsvRecipients(text: string): {
  recipients: ParsedRecipient[];
  errors: string[];
} {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
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
    if (!email || !email.includes("@")) {
      errors.push(`Skipped "${line}" — no valid email`);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: col("name") >= 0 ? cells[col("name")] || undefined : undefined,
      department:
        col("department") >= 0
          ? cells[col("department")] || undefined
          : undefined,
      role: col("role") >= 0 ? cells[col("role")] || undefined : undefined,
      companyName:
        col("company") >= 0
          ? cells[col("company")] || undefined
          : col("company_name") >= 0
            ? cells[col("company_name")] || undefined
            : undefined,
    });
  }
  return { recipients: out, errors };
}

/**
 * Required columns for the channel-partner "Bulk add (CSV)" flow. Order
 * matters only for the user-facing missing-columns message.
 */
const COMPANY_REQUIRED_COLS = [
  "email",
  "name",
  "company",
  "discount",
  "months",
] as const;

/**
 * Strict parser for the partner's company bulk-add CSV.
 *
 * Header is required. All 5 columns must be present; any missing ones go
 * into `missingColumns` so the UI can render the
 * "Please add (field name) field and reupload." message.
 *
 * Per-row, every column must have a non-empty value; discount must parse
 * to 0–100 and months must parse to 1–36 (matching the single-onboard
 * form). Bad rows are pushed to `rowErrors` and dropped from `recipients`,
 * so partial-good CSVs surface every problem at once.
 */
export function parseCompaniesCsvStrict(text: string): CompaniesParseResult {
  const result: CompaniesParseResult = {
    recipients: [],
    missingColumns: [],
    rowErrors: [],
    rowWarnings: [],
  };

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return result;

  const headerCells = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const looksLikeHeader = headerCells.includes("email");
  if (!looksLikeHeader) {
    // No header row at all — treat every required column as missing.
    result.missingColumns = [...COMPANY_REQUIRED_COLS];
    return result;
  }

  // Accept "company" or "company_name" as the same column.
  const normalized = headerCells.map((h) =>
    h === "company_name" ? "company" : h
  );
  const missing = COMPANY_REQUIRED_COLS.filter((c) => !normalized.includes(c));
  if (missing.length > 0) {
    result.missingColumns = missing;
    return result;
  }

  const col = (h: string) => normalized.indexOf(h);
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const cells = lines[i].split(",").map((c) => c.trim());
    const get = (h: string) => cells[col(h)] ?? "";

    const email = get("email").toLowerCase();
    const name = get("name");
    const company = get("company");
    const discRaw = get("discount");
    const monRaw = get("months");

    // Discount is the only soft column: an empty cell defaults to 0 with a
    // warning. Every OTHER required cell must be present, or the row is
    // dropped with an error.
    const rowProblems: string[] = [];
    if (!email) rowProblems.push("email");
    if (!name) rowProblems.push("name");
    if (!company) rowProblems.push("company");
    if (!monRaw) rowProblems.push("months");
    if (rowProblems.length > 0) {
      result.rowErrors.push(
        `Row ${rowNum}: missing ${rowProblems.join(", ")}.`
      );
      continue;
    }

    if (!email.includes("@")) {
      result.rowErrors.push(`Row ${rowNum}: "${email}" is not a valid email.`);
      continue;
    }
    if (seen.has(email)) {
      result.rowErrors.push(`Row ${rowNum}: duplicate email "${email}".`);
      continue;
    }

    // Discount: empty → warn + default to 0; present → must be 0–100.
    let discountPct = 0;
    if (discRaw === "") {
      const rowLabel = company || email || `row ${rowNum}`;
      result.rowWarnings.push(
        `You have not added discount value for ${rowLabel}. By default 0 will be considered.`
      );
    } else {
      const parsed = Number(discRaw);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        result.rowErrors.push(
          `Row ${rowNum}: discount must be a number between 0 and 100 (got "${discRaw}").`
        );
        continue;
      }
      discountPct = parsed;
    }

    const discountMonths = Number(monRaw);
    if (
      !Number.isFinite(discountMonths) ||
      discountMonths < 1 ||
      discountMonths > 36
    ) {
      result.rowErrors.push(
        `Row ${rowNum}: months must be a whole number between 1 and 36 (got "${monRaw}").`
      );
      continue;
    }

    seen.add(email);
    result.recipients.push({
      email,
      name,
      companyName: company,
      discountPct,
      discountMonths: Math.floor(discountMonths),
    });
  }

  return result;
}
