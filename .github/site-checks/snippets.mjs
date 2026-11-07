// Run the signing snippets on index.html and docs.html against the
// real SDKs, and check that every language mints the same URL.
//
// Each page has one tab group of signing snippets: curl (openssl),
// TypeScript, Python, and Rust. For each page this script
//   - runs the curl pane in bash and checks the hash its comment shows,
//   - runs the TypeScript pane against @crabcrop/url,
//   - runs the Python pane against crabcrop_url,
//   - compiles and runs the Rust pane against the crabcrop-url crate,
// then requires every pane to print the same `url` (and `srcset`,
// where more than one pane builds one), and that URL to carry the
// curl pane's hash over the curl pane's remainder.
//
// Usage:
//   node .github/site-checks/snippets.mjs <crabcrop-checkout>
//
// The checkout is a clone of github.com/dayvson/crabcrop with the
// TypeScript SDK built (npm ci && npm run build in sdks/typescript).
// Environment:
//   SNIPPETS_WORK_DIR   where the scratch files and the Rust crate go
//                       (default: a fresh temporary directory)
//   SNIPPETS_CARGO      command that runs cargo inside the Rust crate
//                       directory, given as a prefix: it is called as
//                       `<prefix> <crate-dir> run --quiet --bin <page>`.
//                       Default: plain cargo with --manifest-path.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGES = ["index", "docs"];

const crabcrop = process.argv[2] && resolve(process.argv[2]);
if (!crabcrop || !existsSync(join(crabcrop, "crates", "crabcrop-url"))) {
  console.error("usage: node .github/site-checks/snippets.mjs <crabcrop-checkout>");
  process.exit(2);
}
const tsEntry = join(crabcrop, "sdks", "typescript", "dist", "index.js");
if (!existsSync(tsEntry)) {
  console.error(`missing ${tsEntry}: build the SDK first (npm ci && npm run build in sdks/typescript)`);
  process.exit(2);
}
const work = process.env.SNIPPETS_WORK_DIR
  ? resolve(process.env.SNIPPETS_WORK_DIR)
  : mkdtempSync(join(tmpdir(), "site-snippets-"));
mkdirSync(work, { recursive: true });

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

// The code panes of a page, keyed by their data-pane name.
function panes(page) {
  const html = readFileSync(join(SITE, `${page}.html`), "utf8");
  const out = {};
  const re = /<div class="code-pane[^"]*"([^>]*)>\s*<pre>([\s\S]*?)<\/pre>/g;
  for (const m of html.matchAll(re)) {
    const name = /data-pane="([^"]+)"/.exec(m[1])?.[1];
    if (!name) continue;
    if (out[name]) throw new Error(`${page}.html: two code panes named ${name}`);
    out[name] = decode(m[2]);
  }
  for (const name of ["curl", "ts", "py", "rs"]) {
    if (!out[name]) throw new Error(`${page}.html: no code pane named ${name}`);
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

// The curl pane: the shell command, plus the hash its comment
// promises. Returns the remainder it signs and the hash it gets.
function checkCurl(page, text) {
  const promised = /^#\s*(?:SHA2-256\(stdin\)|\(stdin\))=\s*([0-9a-f]{64})\s*$/m.exec(text)?.[1];
  if (!promised) throw new Error(`${page}.html curl pane: no '# SHA2-256(stdin)= <hex>' comment`);
  const remainder = /printf '%s' '([^']+)'/.exec(text)?.[1];
  if (!remainder) throw new Error(`${page}.html curl pane: no printf '%s' '<remainder>'`);
  const command = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  const got = /([0-9a-f]{64})\s*$/.exec(run("bash", ["-c", command]).trim())?.[1];
  if (got !== promised) {
    throw new Error(`${page}.html curl pane: openssl prints ${got}, the comment says ${promised}`);
  }
  return { remainder, hash: got };
}

function runTs(page, text) {
  const spec = pathToFileURL(tsEntry).href;
  const body = text.replace(/from\s+"@crabcrop\/url"/g, `from ${JSON.stringify(spec)}`);
  if (body === text) throw new Error(`${page}.html TypeScript pane does not import @crabcrop/url`);
  const file = join(work, `${page}-snippet.mts`);
  writeFileSync(
    file,
    `${body}\n\nconsole.log(JSON.stringify({` +
      ["url", "srcset", "signature"]
        .map((v) => `${v}: typeof ${v} === "undefined" ? undefined : ${v}`)
        .join(", ") +
      `}));\n`,
  );
  return JSON.parse(run(process.execPath, [file]));
}

function runPy(page, text) {
  const file = join(work, `${page}_snippet.py`);
  writeFileSync(
    file,
    `${text}\n\nimport json as _json\nprint(_json.dumps({_k: globals().get(_k) for _k in ("url", "srcset", "signature")}))\n`,
  );
  const env = { ...process.env, PYTHONPATH: join(crabcrop, "sdks", "python", "src") };
  return JSON.parse(run("python3", [file], { env }));
}

// All pages' Rust panes become binaries of one scratch crate.
function writeRustCrate(sources) {
  const dir = join(work, "rust");
  mkdirSync(join(dir, "src", "bin"), { recursive: true });
  const lock = join(crabcrop, "Cargo.lock");
  // Pin the dependency versions the crate is tested with upstream.
  if (existsSync(lock) && !existsSync(join(dir, "Cargo.lock"))) copyFileSync(lock, join(dir, "Cargo.lock"));
  writeFileSync(
    join(dir, "Cargo.toml"),
    `[package]\nname = "site-snippets"\nversion = "0.0.0"\nedition = "2024"\npublish = false\n\n` +
      `[dependencies]\ncrabcrop-url = { path = ${JSON.stringify(join(crabcrop, "crates", "crabcrop-url"))} }\n\n[workspace]\n`,
  );
  for (const [page, text] of Object.entries(sources)) {
    const vars = ["url", "srcset", "signature"].filter((v) => new RegExp(`\\blet\\s+${v}\\b`).test(text));
    const fields = vars.map((v) => `    fields.push(format!("\\"${v}\\":{:?}", ${v}));`).join("\n");
    writeFileSync(
      join(dir, "src", "bin", `${page}.rs`),
      `// Generated from the Rust pane of ${page}.html.\n` +
        `fn main() -> Result<(), Box<dyn std::error::Error>> {\n${text}\n` +
        `    let mut fields: Vec<String> = Vec::new();\n${fields}\n` +
        `    println!("{{{}}}", fields.join(","));\n    Ok(())\n}\n`,
    );
  }
  return dir;
}

function runRust(dir, page) {
  const prefix = process.env.SNIPPETS_CARGO;
  const out = prefix
    ? run(prefix.split(" ")[0], [...prefix.split(" ").slice(1), dir, "run", "--quiet", "--bin", page])
    : run("cargo", ["run", "--quiet", "--manifest-path", join(dir, "Cargo.toml"), "--bin", page]);
  return JSON.parse(out.trim().split("\n").pop());
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

const all = Object.fromEntries(PAGES.map((p) => [p, panes(p)]));
let rustDir;
try {
  rustDir = writeRustCrate(Object.fromEntries(PAGES.map((p) => [p, all[p].rs])));
} catch (e) {
  fail(`writing the Rust crate: ${e.message}`);
}

for (const page of PAGES) {
  const results = {};
  let curl;
  try {
    curl = checkCurl(page, all[page].curl);
    console.log(`ok   ${page}.html curl: ${curl.hash}`);
  } catch (e) {
    fail(e.message);
  }
  for (const [lang, runner] of [
    ["ts", () => runTs(page, all[page].ts)],
    ["py", () => runPy(page, all[page].py)],
    ["rs", () => runRust(rustDir, page)],
  ]) {
    try {
      results[lang] = runner();
      console.log(`ok   ${page}.html ${lang}: ${results[lang].url}`);
    } catch (e) {
      const detail = (e.stderr || e.message || "").toString().trim().split("\n").slice(-12).join("\n     ");
      fail(`${page}.html ${lang} pane does not run:\n     ${detail}`);
    }
  }
  const langs = Object.keys(results);
  for (const field of ["url", "srcset", "signature"]) {
    const have = langs.filter((l) => results[l][field] !== undefined && results[l][field] !== null);
    const values = new Set(have.map((l) => results[l][field]));
    if (values.size > 1) {
      fail(`${page}.html: the panes disagree on ${field}:\n` + have.map((l) => `     ${l}: ${results[l][field]}`).join("\n"));
    }
  }
  if (curl) {
    for (const l of langs) {
      const { url, signature } = results[l];
      if (url !== undefined && !url.endsWith(`/${curl.hash}/${curl.remainder}`)) {
        fail(`${page}.html ${l}: ${url} does not sign the curl pane's remainder (${curl.remainder}) to ${curl.hash}`);
      }
      if (signature !== undefined && signature !== null && signature !== curl.hash) {
        fail(`${page}.html ${l}: signature ${signature} is not the curl pane's ${curl.hash}`);
      }
    }
  }
  if (!langs.some((l) => results[l].url !== undefined)) fail(`${page}.html: no pane produced a url`);
}

if (failures) {
  console.error(`\n${failures} snippet check(s) failed`);
  process.exit(1);
}
console.log("\nall signing snippets run and agree");
