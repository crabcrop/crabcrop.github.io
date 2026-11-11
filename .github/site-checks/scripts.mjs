// Check that the site loads no third-party script and that its main
// pages carry a Content-Security-Policy that matches their scripts.
//
// The check fails when
//   - a published page loads a script from a host that is not on
//     SCRIPT_HOSTS (empty: the site loads scripts from itself only),
//   - a published page or script names an analytics tag
//     (googletagmanager.com, google-analytics.com or gtag()),
//   - index.html or docs.html has no CSP meta tag,
//   - or a page with a CSP meta tag breaks it: the tag comes after a
//     script, style or link; script-src allows more than 'self', hashes
//     and SCRIPT_HOSTS; an inline script's hash is missing, or a hash
//     matches no inline script; an inline event handler or javascript:
//     URL would be blocked; an image host is not in img-src; or
//     object-src or base-uri is not 'none'.
//
// After an edit to an inline script, the failure prints the hash the
// CSP needs.
//
// Published means tracked (git ls-files) and not left out by Jekyll:
// no path segment starts with ".", "_", "#" or ends with "~", and no
// path is under an exclude entry of _config.yml.
//
// Usage:
//   node .github/site-checks/scripts.mjs [site-checkout]
// The checkout defaults to the repository this script is in.
// config-table.mjs also runs it, since it needs no crabcrop checkout.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Hosts a page may load scripts from besides crabcrop.org. A host added
// here must also go in the script-src of each page that uses it.
const SCRIPT_HOSTS = new Set([]);
const CSP_PAGES = ["index.html", "docs.html"];
const ORIGIN = "https://crabcrop.org/";
const SITE_HOSTS = new Set(["crabcrop.org", "www.crabcrop.org"]);
const ANALYTICS = /googletagmanager\.com|google-analytics\.com|\bgtag\s*\(/;
const JS_TYPES = new Set(["", "module", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"]);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescape = (s) =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const blank = (s) => s.replace(/[^\n]/g, " ");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const attrsOf = (s) => {
  const out = {};
  for (const a of s.matchAll(ATTR)) out[a[1].toLowerCase()] = unescape(a[2] ?? a[3] ?? a[4] ?? "");
  return out;
};

// The files Pages publishes: tracked, minus what Jekyll leaves out.
function publishedFiles(site) {
  const tracked = execFileSync("git", ["-C", site, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const exclude = [];
  const config = join(site, "_config.yml");
  if (existsSync(config)) {
    let inList = false;
    for (const line of readFileSync(config, "utf8").split("\n")) {
      if (/^exclude:\s*(?:#.*)?$/.test(line)) inList = true;
      else if (inList && /^\s*-\s*/.test(line))
        exclude.push(line.replace(/^\s*-\s*|\s*(?:#.*)?$/g, "").replace(/^["']|["']$/g, "").replace(/\/$/, ""));
      else if (inList && /^\S/.test(line)) inList = false;
    }
  }
  return tracked.filter(
    (f) =>
      !f.split("/").some((seg) => /^[._#]/.test(seg) || seg.endsWith("~")) &&
      !exclude.some((e) => f === e || f.startsWith(`${e}/`)),
  );
}

// The host a URL on page names, "self" for this site, or null when it
// is not a fetchable URL.
function hostOf(ref, page) {
  let url;
  try {
    url = new URL(ref.trim(), ORIGIN + page);
  } catch {
    return null;
  }
  if (url.protocol === "data:") return "data:";
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return SITE_HOSTS.has(url.hostname) ? "self" : url.hostname;
}

// The directives of a CSP string: { name: [tokens] }.
function parseCsp(value) {
  const out = {};
  for (const part of value.split(";")) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (name && !(name.toLowerCase() in out)) out[name.toLowerCase()] = tokens;
  }
  return out;
}

const allows = (tokens, host) =>
  host === "self" ? tokens.includes("'self'") : host === "data:" ? tokens.includes("data:") : tokens.includes(`https://${host}`);

export function checkScripts(site) {
  const problems = [];
  const files = publishedFiles(site);
  const pages = files.filter((f) => /\.html?$/i.test(f));
  for (const f of CSP_PAGES) if (!pages.includes(f)) problems.push(`${f} is not a published page`);

  for (const f of files.filter((x) => /\.(?:html?|m?js)$/i.test(x))) {
    const text = readFileSync(join(site, f), "utf8");
    const m = ANALYTICS.exec(text);
    if (m) problems.push(`${f}:${lineOf(text, m.index)} names an analytics tag (${m[0]})`);
  }

  let cspPages = 0;
  let inline = 0;
  for (const page of pages) {
    const raw = readFileSync(join(site, page), "utf8");
    const text = raw.replace(/<!--[\s\S]*?-->/g, blank);
    const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((m) => ({
      line: lineOf(text, m.index),
      index: m.index,
      attrs: attrsOf(m[1]),
      body: m[2],
    }));

    for (const s of scripts) {
      if (!("src" in s.attrs)) continue;
      const host = hostOf(s.attrs.src, page);
      if (host !== "self" && !SCRIPT_HOSTS.has(host)) {
        problems.push(`${page}:${s.line} loads a script from ${host ?? s.attrs.src}, which is not an allowed script host`);
      }
    }

    // Tags outside script and style bodies.
    const markup = text.replace(
      /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
      (m, open, name, body, close) => open + blank(body) + close,
    );
    const tags = [...markup.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g)].map(
      (m) => ({ name: m[1].toLowerCase(), attrs: attrsOf(m[2]), index: m.index, line: lineOf(markup, m.index) }),
    );
    const cspTag = tags.find(
      (t) => t.name === "meta" && (t.attrs["http-equiv"] || "").toLowerCase() === "content-security-policy",
    );
    if (!cspTag) {
      if (CSP_PAGES.includes(page)) problems.push(`${page} has no <meta http-equiv="Content-Security-Policy">`);
      continue;
    }
    cspPages += 1;

    const first = tags.find((t) => ["script", "style", "link"].includes(t.name));
    if (first && first.index < cspTag.index) {
      problems.push(`${page}:${cspTag.line} the CSP meta tag comes after the <${first.name}> on line ${first.line}, so it does not cover it`);
    }

    const csp = parseCsp(cspTag.attrs.content || "");
    const scriptSrc = csp["script-src"] ?? csp["default-src"] ?? [];
    for (const tok of scriptSrc) {
      const ok =
        tok === "'self'" || /^'sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}'$/.test(tok) || SCRIPT_HOSTS.has(tok.replace(/^https:\/\//, ""));
      if (!ok) problems.push(`${page}: script-src allows ${tok}; use 'self', a hash, or a host from SCRIPT_HOSTS`);
    }
    for (const name of ["object-src", "base-uri"]) {
      const tokens = csp[name] ?? (name === "object-src" ? csp["default-src"] : undefined);
      if (!tokens || tokens.join(" ") !== "'none'") problems.push(`${page}: the CSP must set ${name} 'none'`);
    }

    const hashes = new Set(scriptSrc.filter((t) => t.startsWith("'sha256-")).map((t) => t.slice(1, -1)));
    const needed = new Set();
    for (const s of scripts) {
      if ("src" in s.attrs) {
        const host = hostOf(s.attrs.src, page);
        if (host && !allows(scriptSrc, host)) problems.push(`${page}:${s.line} loads a script from ${host}, which script-src does not allow`);
        continue;
      }
      if (!JS_TYPES.has((s.attrs.type || "").trim().toLowerCase())) continue;
      inline += 1;
      const hash = `sha256-${createHash("sha256").update(s.body, "utf8").digest("base64")}`;
      needed.add(hash);
      if (!hashes.has(hash)) problems.push(`${page}:${s.line} has an inline script that script-src does not list: add '${hash}'`);
    }
    for (const h of hashes) if (!needed.has(h)) problems.push(`${page}: script-src lists '${h}', which matches no inline script`);

    const imgSrc = csp["img-src"] ?? csp["default-src"] ?? [];
    for (const t of tags) {
      for (const [name, value] of Object.entries(t.attrs)) {
        if (/^on[a-z]+$/.test(name)) problems.push(`${page}:${t.line} has an inline ${name} handler, which the CSP blocks`);
        if (/^\s*javascript:/i.test(value)) problems.push(`${page}:${t.line} has a javascript: URL, which the CSP blocks`);
      }
      const urls = [];
      if (t.name === "img" && t.attrs.src) urls.push(t.attrs.src);
      if ((t.name === "img" || t.name === "source") && t.attrs.srcset) {
        for (const c of t.attrs.srcset.split(/,\s+/)) urls.push(c.trim().split(/\s+/)[0]);
      }
      for (const u of urls) {
        const host = hostOf(u, page);
        if (host && !allows(imgSrc, host)) problems.push(`${page}:${t.line} loads an image from ${host}, which img-src does not allow`);
      }
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${problems.length} script or CSP problem(s) in ${site}`);
    return false;
  }
  console.log(`ok   ${pages.length} published pages load scripts only from this site, and none names an analytics tag`);
  console.log(`ok   ${cspPages} pages carry a CSP that lists their ${inline} inline scripts and every script and image host`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const site = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  if (!existsSync(join(site, "index.html"))) {
    console.error("usage: node .github/site-checks/scripts.mjs [site-checkout]");
    process.exit(2);
  }
  process.exit(checkScripts(site) ? 0 : 1);
}
