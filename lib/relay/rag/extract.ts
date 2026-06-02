/*
 * Document text extraction for the RAG indexer. PDF via unpdf (serverless-safe
 * pdf.js), DOCX via mammoth, plain text/markdown/csv read directly. Image OCR
 * is intentionally NOT handled (skipped). Node-only (uses Buffer).
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

export function isParseableDocument(name: string, mime: string): boolean {
  const lower = name.toLowerCase();
  return (
    mime === "application/pdf" ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    mime.includes("wordprocessingml") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime.startsWith("text/") ||
    /\.(txt|md|markdown|csv|tsv|json|log)$/.test(lower)
  );
}

export async function extractDocumentText(
  name: string,
  mime: string,
  buffer: Buffer,
): Promise<string | null> {
  const lower = name.toLowerCase();
  try {
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : (text ?? null);
    }
    if (lower.endsWith(".docx") || mime.includes("wordprocessingml")) {
      const { value } = await mammoth.extractRawText({ buffer });
      return value ?? null;
    }
    if (
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls") ||
      mime.includes("spreadsheetml") ||
      mime.includes("ms-excel")
    ) {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const parts: string[] = [];
      for (const sheet of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet]);
        if (csv.trim()) parts.push(`# Sheet: ${sheet}\n${csv}`);
      }
      return parts.join("\n\n") || null;
    }
    if (mime.startsWith("text/") || /\.(txt|md|markdown|csv|tsv|json|log)$/.test(lower)) {
      return buffer.toString("utf8");
    }
  } catch (e) {
    console.warn(`[rag] failed to extract "${name}" (${mime}):`, e);
  }
  return null;
}
