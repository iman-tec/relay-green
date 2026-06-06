/*
 * ui-diff.mjs — compare two ui-snapshot label dirs and report DOM differences.
 *   node scripts/ui-diff.mjs baseline after
 * Exit 0 + "IDENTICAL" when every state matches; else prints diffs, exit 1.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: node scripts/ui-diff.mjs <labelA> <labelB>"); process.exit(2); }
const dirA = path.join(ROOT, "perf", `ui-${a}`);
const dirB = path.join(ROOT, "perf", `ui-${b}`);

function lineDiff(A, B, max = 40) {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (A[i] === B[j]) { i++; j++; continue; }
    let resynced = false;
    for (let k = 1; k <= 6 && !resynced; k++) {
      if (A[i + k] === B[j]) { for (let x = 0; x < k; x++) out.push(`  - ${A[i + x]}`); i += k; resynced = true; }
      else if (A[i] === B[j + k]) { for (let x = 0; x < k; x++) out.push(`  + ${B[j + x]}`); j += k; resynced = true; }
    }
    if (!resynced) {
      if (i < A.length) out.push(`  - ${A[i++]}`);
      if (j < B.length) out.push(`  + ${B[j++]}`);
    }
    if (out.length >= max) { out.push("  … (truncated)"); break; }
  }
  return out;
}

const states = existsSync(dirA) ? readdirSync(dirA).filter((f) => f.endsWith(".html")).sort() : [];
let totalDiff = 0;
for (const f of states) {
  const pb = path.join(dirB, f);
  if (!existsSync(pb)) { console.log(`MISSING in ${b}: ${f}`); totalDiff++; continue; }
  const A = readFileSync(path.join(dirA, f), "utf8").split("\n");
  const B = readFileSync(pb, "utf8").split("\n");
  if (A.join("\n") === B.join("\n")) { console.log(`  ✓ ${f.padEnd(22)} identical (${A.length} lines)`); continue; }
  const d = lineDiff(A, B);
  console.log(`  ✗ ${f.padEnd(22)} DIFFERS (${d.length} diff lines):`);
  for (const line of d) console.log("    " + line);
  totalDiff += d.length;
}
console.log(totalDiff === 0 ? `\nIDENTICAL — ${states.length} states match.` : `\n${totalDiff} differing lines across states.`);
process.exit(totalDiff === 0 ? 0 : 1);
