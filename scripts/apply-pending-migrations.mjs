// One-off: apply pending Supabase migrations (version > LIVE_AT) in order
// via the Management API query endpoint, recording each in
// supabase_migrations.schema_migrations. Stops on the first failure.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TOKEN = process.env.SB_TOKEN;
const REF = "vdduelvjrzeczmakxgpn";
const LIVE_AT = "20260527220000"; // highest version already applied on live
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

const migDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "migrations"
);

async function runSQL(query) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// Fetch already-applied versions so this runner is resumable + idempotent.
const appliedRes = await runSQL(
  "select version from supabase_migrations.schema_migrations;"
);
const applied = new Set(
  JSON.parse(appliedRes.text || "[]").map((r) => String(r.version))
);

const files = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => f.split("_")[0] > LIVE_AT)
  .filter((f) => !applied.has(f.split("_")[0]))
  .sort((a, b) => (a < b ? -1 : 1));

console.log(
  `Already applied (in window): ${[...applied].filter((v) => v > LIVE_AT).length}`
);
console.log(`Pending migrations to apply: ${files.length}`);

for (const f of files) {
  const version = f.split("_")[0];
  const name = f.replace(/^[0-9]+_/, "").replace(/\.sql$/, "");
  const sql = readFileSync(join(migDir, f), "utf8");
  process.stdout.write(`\n▶ ${f} ... `);

  const r = await runSQL(sql);
  if (!r.ok) {
    console.log(`FAILED (HTTP ${r.status})`);
    console.log(r.text.slice(0, 1200));
    console.log(
      `\n✋ Stopped. ${files.indexOf(f)} migration(s) applied before this one.`
    );
    process.exit(1);
  }

  // Record it so the live migration history matches the repo.
  const nameEsc = name.replace(/'/g, "''");
  const rec = await runSQL(
    `insert into supabase_migrations.schema_migrations(version, name) values ('${version}','${nameEsc}') on conflict (version) do nothing;`
  );
  if (!rec.ok) {
    console.log(`applied OK but FAILED to record version (HTTP ${rec.status})`);
    console.log(rec.text.slice(0, 600));
    console.log(`\n✋ Stopped after applying ${f} but not recording it.`);
    process.exit(2);
  }
  console.log("OK");
}

console.log(
  `\n✅ All ${files.length} pending migrations applied and recorded.`
);
