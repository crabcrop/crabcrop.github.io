// Diff the error and filter reference on docs.html against
// docs/responses.md and docs/filters.md in the crabcrop repo.
//
// The site's reference is marked up for this check:
//   - <p data-grammar-codes>: the grammar failure codes (all 400);
//   - <table data-error-codes>: every other code, with its status;
//   - <table data-status-table>: the statuses a client can get;
//   - <table data-filter-table>: the filter tables, by section.
// The check fails when
//   - a code in docs/responses.md is missing from the site, the site
//     gives it another status, or the site names a code the repo does
//     not have;
//   - a status in the repo's status table is missing from the site, or
//     the site lists a status that no doc in the repo, CHANGELOG.md
//     included, mentions as `NNN`;
//   - a filter or directive in the tables of docs/filters.md is missing
//     from the site's filter tables, or the site lists one the repo's
//     tables do not have.
// Descriptions are prose and are not compared.
//
// Usage:
//   node .github/site-checks/reference-tables.mjs <crabcrop-checkout>

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const crabcrop = process.argv[2] && resolve(process.argv[2]);
const docs = crabcrop && join(crabcrop, "docs");
if (!docs || !existsSync(join(docs, "responses.md")) || !existsSync(join(docs, "filters.md"))) {
  console.error("usage: node .github/site-checks/reference-tables.mjs <crabcrop-checkout>");
  process.exit(2);
}

const CODE = /^[a-z][a-z0-9_]*$/;

function decode(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

// Markdown table rows as arrays of trimmed cells.
function mdCells(line) {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim());
}
const ticked = (cell) => /^`([^`]+)`$/.exec(cell)?.[1];

// ---- The repo ----

const responses = readFileSync(join(docs, "responses.md"), "utf8");

// "Grammar failures (a `400` below) carry the parser's stable names:
// `empty_path`, ... ." The list runs to the end of that sentence.
const grammarLine = responses.split("\n").find((l) => l.startsWith("Grammar failures"));
if (!grammarLine) {
  console.error("docs/responses.md has no 'Grammar failures' paragraph");
  process.exit(1);
}
const grammarList = grammarLine.slice(grammarLine.indexOf(":") + 1).split(/\.(\s|$)/)[0];
const repoGrammar = new Set([...grammarList.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((c) => CODE.test(c)));

// The code table (`code` | `status` | ...) and the status table
// (`status` | meaning).
const repoCodes = new Map();
const repoStatuses = new Set();
for (const line of responses.split("\n")) {
  if (!line.startsWith("| `")) continue;
  const cells = mdCells(line);
  const first = ticked(cells[0]);
  if (first && /^\d{3}$/.test(first)) repoStatuses.add(first);
  else if (first && CODE.test(first) && /^`\d{3}`$/.test(cells[1] || "")) repoCodes.set(first, ticked(cells[1]));
}

// Every `NNN` any doc or the CHANGELOG mentions: a status the site
// lists beyond the status table must at least be one of these.
const mentioned = new Set();
const prose = readdirSync(docs)
  .filter((f) => f.endsWith(".md"))
  .map((f) => join(docs, f));
if (existsSync(join(crabcrop, "CHANGELOG.md"))) prose.push(join(crabcrop, "CHANGELOG.md"));
for (const file of prose) {
  for (const m of readFileSync(file, "utf8").matchAll(/`([1-5]\d\d)`/g)) mentioned.add(m[1]);
}

// The filter tables: those whose header's first cell is Filter or
// Directive (the parameter and argument tables are not lists of filters).
const repoFilters = new Set();
{
  const lines = readFileSync(join(docs, "filters.md"), "utf8").split("\n");
  let inFilterTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) {
      inFilterTable = false;
      continue;
    }
    if (/^\|\s*-/.test(lines[i + 1] || "")) {
      inFilterTable = /^(Filter|Directive)$/.test(mdCells(line)[0]);
      continue;
    }
    if (!inFilterTable || /^\|\s*-/.test(line)) continue;
    const name = ticked(mdCells(line)[0]);
    if (name && CODE.test(name)) repoFilters.add(name);
  }
}

// ---- The site ----

const html = readFileSync(join(SITE, "docs.html"), "utf8");

function marked(tag, attr) {
  const found = [...html.matchAll(new RegExp(`<${tag}[^>]*\\b${attr}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
  if (found.length === 0) {
    console.error(`docs.html has no <${tag}> marked ${attr}`);
    process.exit(1);
  }
  return found;
}
function rows(body) {
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) => [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1])))
    .filter((cells) => cells.length >= 2);
}

const problems = [];

const siteGrammar = new Set();
for (const body of marked("p", "data-grammar-codes")) {
  for (const m of body.matchAll(/<code>([^<]+)<\/code>/g)) {
    if (CODE.test(m[1])) siteGrammar.add(m[1]);
  }
}

const siteCodes = new Map();
for (const body of marked("table", "data-error-codes")) {
  for (const [code, status] of rows(body)) {
    if (siteCodes.has(code) || siteGrammar.has(code)) problems.push(`docs.html lists the code ${code} twice`);
    siteCodes.set(code, status);
  }
}

const siteStatuses = new Set();
for (const body of marked("table", "data-status-table")) {
  for (const [status] of rows(body)) {
    if (siteStatuses.has(status)) problems.push(`docs.html lists the status ${status} twice`);
    siteStatuses.add(status);
  }
}

// "blurfaces, pixelatefaces", "upscale(2) or upscale(4)" and
// "recolorclass(class,hex)" name filters too: drop the arguments, then
// split on commas and "or".
const siteFilters = new Set();
for (const body of marked("table", "data-filter-table")) {
  for (const [first] of rows(body)) {
    const names = new Set(
      first
        .replace(/\([^)]*\)/g, "")
        .split(/,|\bor\b/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    for (const name of names) {
      if (!CODE.test(name)) {
        problems.push(`docs.html filter table row "${first}" does not name a filter`);
        continue;
      }
      if (siteFilters.has(name)) problems.push(`docs.html lists the filter ${name} twice`);
      siteFilters.add(name);
    }
  }
}

// ---- The diff ----

for (const code of repoGrammar) {
  if (!siteGrammar.has(code)) problems.push(`grammar code missing on the site: ${code}`);
}
for (const code of siteGrammar) {
  if (!repoGrammar.has(code)) problems.push(`grammar code not in docs/responses.md: ${code}`);
}
for (const [code, status] of repoCodes) {
  if (!siteCodes.has(code)) problems.push(`code missing on the site: ${code} (${status})`);
  else if (siteCodes.get(code) !== status) problems.push(`status differs for ${code}: site ${siteCodes.get(code)}, repo ${status}`);
}
for (const code of siteCodes.keys()) {
  if (!repoCodes.has(code)) problems.push(`code not in docs/responses.md: ${code}`);
}
for (const status of repoStatuses) {
  if (!siteStatuses.has(status)) problems.push(`status missing on the site: ${status}`);
}
for (const status of siteStatuses) {
  if (!repoStatuses.has(status) && !mentioned.has(status)) {
    problems.push(`status ${status} is not in docs/responses.md, and no doc or CHANGELOG.md mentions it`);
  }
}
for (const name of repoFilters) {
  if (!siteFilters.has(name)) problems.push(`filter missing on the site: ${name}`);
}
for (const name of siteFilters) {
  if (!repoFilters.has(name)) problems.push(`filter not in the tables of docs/filters.md: ${name}`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`\n${problems.length} reference difference(s) against ${docs}`);
  process.exit(1);
}
const extra = [...siteStatuses].filter((s) => !repoStatuses.has(s));
console.log(
  `ok   ${repoGrammar.size} grammar codes and ${repoCodes.size} other codes match docs/responses.md`,
);
console.log(
  `ok   ${siteStatuses.size} statuses cover the ${repoStatuses.size} in docs/responses.md` +
    (extra.length ? ` (plus ${extra.join(", ")}, documented elsewhere in the repo)` : ""),
);
console.log(`ok   ${siteFilters.size} filters and directives match the tables of docs/filters.md`);
