// Diff the configuration tables on docs.html against
// docs/configuration.md in the crabcrop repo.
//
// The site's tables are the ones marked data-config-table. The check
// fails when
//   - a variable in the repo's table is missing from the site,
//   - the site names a variable the repo's configuration page never
//     mentions (aliases such as CRABCROP_PORT are mentioned there),
//   - or a variable's default differs (backticks and spacing aside).
// Descriptions are prose and are not compared.
//
// Usage:
//   node .github/site-checks/config-table.mjs <crabcrop-checkout>

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const crabcrop = process.argv[2] && resolve(process.argv[2]);
const mdPath = crabcrop && join(crabcrop, "docs", "configuration.md");
if (!mdPath || !existsSync(mdPath)) {
  console.error("usage: node .github/site-checks/config-table.mjs <crabcrop-checkout>");
  process.exit(2);
}

const NAME = /\b(?:CRABCROP_[A-Z0-9_]+|PORT)\b/g;
const norm = (s) => s.replace(/`/g, "").replace(/\s+/g, " ").trim();

function decode(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// The repo: every table row of docs/configuration.md whose first cell
// is code, which today is the one variables table.
const md = readFileSync(mdPath, "utf8");
const repo = new Map();
for (const line of md.split("\n")) {
  if (!line.startsWith("| `")) continue;
  const cells = line.split(/(?<!\\)\|/).slice(1, 3).map((c) => c.trim());
  const names = cells[0].match(NAME) || [];
  for (const n of names) repo.set(n, norm(cells[1]));
}
const mentioned = new Set(md.match(NAME));

// The site: rows of every data-config-table table on docs.html.
const html = readFileSync(join(SITE, "docs.html"), "utf8");
const site = new Map();
const tables = [...html.matchAll(/<table[^>]*\bdata-config-table\b[^>]*>([\s\S]*?)<\/table>/g)];
if (tables.length === 0) {
  console.error("docs.html has no table marked data-config-table");
  process.exit(1);
}
for (const [, body] of tables) {
  for (const [, row] of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
    if (cells.length < 2) continue;
    for (const n of cells[0].match(NAME) || []) {
      if (site.has(n)) {
        console.error(`docs.html lists ${n} twice`);
        process.exit(1);
      }
      site.set(n, norm(cells[1]));
    }
  }
}

const problems = [];
for (const [name, def] of repo) {
  if (!site.has(name)) problems.push(`missing on the site: ${name} (default ${def})`);
  else if (site.get(name) !== def) problems.push(`default differs for ${name}: site "${site.get(name)}", repo "${def}"`);
}
for (const name of site.keys()) {
  if (!repo.has(name) && !mentioned.has(name)) problems.push(`not in docs/configuration.md: ${name}`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`\n${problems.length} configuration difference(s) against ${mdPath}`);
  process.exit(1);
}
console.log(`ok   ${site.size} variables on docs.html match the ${repo.size} in docs/configuration.md`);
