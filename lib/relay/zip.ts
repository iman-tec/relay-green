/*
 * Minimal stored-mode ZIP writer.
 *
 * Produces a valid PKZIP archive with NO compression (method 0 = stored).
 * Good enough for shipping CSV/JSON bundles where text repetition is
 * already low and the extra archiver+inflate weight isn't worth it.
 *
 * Stored mode = the file body in the archive is byte-identical to the
 * input, with just header + central-directory metadata around each
 * entry. Any standard unzip tool reads it correctly.
 *
 * Spec ref: PKWARE APPNOTE.TXT v6.3.10, sections 4.3.7, 4.3.12, 4.3.16.
 */

const SIG_LFH = 0x04034b50; // Local file header
const SIG_CDFH = 0x02014b50; // Central directory file header
const SIG_EOCD = 0x06054b50; // End of central directory

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

/**
 * Build a stored-mode ZIP from the given entries.
 *
 * - DOS timestamp baked in as 1980-01-01 00:00:00 (the zero-mtime
 *   default; unzip tools accept it). We don't surface modification
 *   times for these synthetic CSVs.
 * - Filenames must be ASCII-clean (no diacritics / multi-byte) since
 *   we don't set the UTF-8 flag. Use plain names like "members.csv".
 * - Entry size is capped at 4 GiB (32-bit ZIP, not zip64). Plenty for
 *   any single-org export.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = encoder.encode(e.name);
    const dataBytes =
      typeof e.data === "string" ? encoder.encode(e.data) : e.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + filename).
    const lfh = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0, SIG_LFH, true);
    lfh.setUint16(4, 20, true); // version needed (2.0)
    lfh.setUint16(6, 0, true); // general purpose flag
    lfh.setUint16(8, 0, true); // compression method (stored)
    lfh.setUint16(10, 0, true); // last mod time (00:00:00)
    lfh.setUint16(12, 0x21, true); // last mod date (1980-01-01)
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, size, true); // compressed = uncompressed (stored)
    lfh.setUint32(22, size, true);
    lfh.setUint16(26, nameBytes.length, true);
    lfh.setUint16(28, 0, true); // extra field length

    parts.push(new Uint8Array(lfh.buffer));
    parts.push(nameBytes);
    parts.push(dataBytes);

    // Central directory file header (46 bytes + filename).
    const cdfh = new DataView(new ArrayBuffer(46));
    cdfh.setUint32(0, SIG_CDFH, true);
    cdfh.setUint16(4, 20, true); // version made by
    cdfh.setUint16(6, 20, true); // version needed
    cdfh.setUint16(8, 0, true);
    cdfh.setUint16(10, 0, true);
    cdfh.setUint16(12, 0, true);
    cdfh.setUint16(14, 0x21, true);
    cdfh.setUint32(16, crc, true);
    cdfh.setUint32(20, size, true);
    cdfh.setUint32(24, size, true);
    cdfh.setUint16(28, nameBytes.length, true);
    cdfh.setUint16(30, 0, true); // extra field length
    cdfh.setUint16(32, 0, true); // comment length
    cdfh.setUint16(34, 0, true); // disk number start
    cdfh.setUint16(36, 0, true); // internal attrs
    cdfh.setUint32(38, 0, true); // external attrs
    cdfh.setUint32(42, offset, true); // local header offset

    cdParts.push(new Uint8Array(cdfh.buffer));
    cdParts.push(nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const p of cdParts) cdSize += p.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, SIG_EOCD, true);
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with CD
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdOffset, true);
  eocd.setUint16(20, 0, true); // comment length

  // Concatenate everything.
  const all = [...parts, ...cdParts, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const p of all) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/**
 * CSV-escape one cell. RFC 4180-ish: wrap in quotes when the cell
 * contains a comma, quote, newline, or leading/trailing whitespace;
 * escape inner quotes by doubling them.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV from a header row + body rows. Joins with CRLF (Excel-friendly). */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  const lines: string[] = [];
  lines.push(header.map(csvCell).join(","));
  for (const r of rows) {
    lines.push(r.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
