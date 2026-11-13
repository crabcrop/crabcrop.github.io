// Check which scripts the site's pages load, and that its main pages
// carry a Content-Security-Policy that matches their scripts.
//
// The one script from another host a page may load is the Google tag
// of the site's Google Analytics property, by the exact URL GA_LOADER.
// The check fails when
//   - a published page loads a script from another host by any other
//     URL;
//   - a published page or script names a Google tag host (GOOGLE_HOSTS)
//     outside that loader's <script> tag and a CSP meta tag, which
//     catches a tag injected by an inline loader, or names a Google tag
//     ID other than GA_ID, since gtag('config', ID) makes gtag.js load
//     that tag's script too;
//   - index.html or docs.html has no CSP meta tag;
//   - a page with a CSP meta tag breaks it: it has more than one; the
//     tag is not the first tag after <meta charset>, or comes after a
//     script, style or link; script-src allows more than 'self', sha256
//     hashes and the hosts of the scripts the page loads, or
//     script-src-elem or script-src-attr overrides it; another directive
//     allows a source that SOURCES (or GA_CSP, on a page that loads
//     GA_LOADER) does not list for it; an inline script's hash is
//     missing, or a hash matches no inline script; an inline event
//     handler or javascript: URL would be blocked; an image host is not
//     in img-src; a page that loads GA_LOADER lacks a source of GA_CSP;
//     or object-src or base-uri is not 'none';
//   - or, while a published page loads GA_LOADER, the privacy note
//     (id="privacy") on index.html or docs.html is missing or hidden,
//     does not say the site uses Google Analytics, or says it does not,
//     or says the site uses no analytics or sets no cookies.
//
// After an edit to an inline script, the failure prints the hash the
// CSP needs.
//
// Before it checks the site, it runs its self-tests: fixture sites it
// must pass, and broken ones it must catch.
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

// The Google Analytics 4 property the site reports to, and its loader.
const GA_ID = "G-56Q9ZPMWLX";
const GA_LOADER = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
// What a page that loads GA_LOADER must allow, from Google's CSP guide
// for Google Analytics 4. script-src names the loader's own host, not
// Google's *.googletagmanager.com, and nothing in GA needs
// 'unsafe-inline' or 'unsafe-eval': the inline config goes by hash.
const GA_CSP = {
  "script-src": ["https://www.googletagmanager.com"],
  "img-src": ["https://*.google-analytics.com", "https://*.googletagmanager.com"],
  "connect-src": ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"],
};
// The sources a CSP directive other than script-src may allow, besides
// 'self' and 'none'. A page that loads GA_LOADER may also allow GA_CSP.
const SOURCES = {
  "style-src": ["'unsafe-inline'"],
  "img-src": ["data:", "https://images.crabcrop.org"],
};
const GA_SOURCES = new Set(Object.values(GA_CSP).flat());
const GOOGLE_HOSTS = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net/gi;
const GOOGLE_TAG_ID = /\b(?:G|GT|GTM|AW|DC|UA)-[A-Z0-9]{4,}\b/g;
const CSP_PAGES = ["index.html", "docs.html"];
const ORIGIN = "https://crabcrop.org/";
const SITE_HOSTS = new Set(["crabcrop.org", "www.crabcrop.org"]);
// The <script> types a browser runs or reads as inline script, so the
// CSP has to list them by hash: the JavaScript MIME types of the HTML
// standard, modules, import maps and speculation rules.
const JS_TYPES = new Set([
  "", "module", "importmap", "speculationrules",
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
  "text/javascript1.3", "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript",
  "text/x-ecmascript", "text/x-javascript",
]);
// The type a browser gives an inline script: its type attribute, or
// text/ plus its language attribute, or JavaScript.
const typeOf = (attrs) =>
  ("type" in attrs ? attrs.type : attrs.language ? `text/${attrs.language}` : "").trim().toLowerCase();

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
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
const hashOf = (body) => `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;

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

// The scripts and tags of a page. Comments are blanked out first, so
// indexes into the result are indexes into the page.
function parsePage(raw) {
  const text = raw.replace(/<!--[\s\S]*?-->/g, blank);
  const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((m) => ({
    line: lineOf(text, m.index),
    index: m.index,
    openEnd: m.index + "<script".length + m[1].length + 1,
    attrs: attrsOf(m[1]),
    body: m[2],
  }));
  // Tags outside script and style bodies.
  const markup = text.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (m, open, name, body, close) => open + blank(body) + close,
  );
  const tags = [...markup.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g)].map(
    (m) => ({ name: m[1].toLowerCase(), attrs: attrsOf(m[2]), index: m.index, end: m.index + m[0].length, line: lineOf(markup, m.index) }),
  );
  const cspTags = tags.filter((t) => t.name === "meta" && (t.attrs["http-equiv"] || "").toLowerCase() === "content-security-policy");
  return { markup, scripts, tags, cspTags };
}

// The text of the element that tag opens, tags dropped.
function textOf(markup, tag) {
  const re = new RegExp(`<(/?)${tag.name}\\b[^>]*>`, "gi");
  re.lastIndex = tag.end;
  let depth = 1;
  let end = markup.length;
  for (let m; (m = re.exec(markup)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      end = m.index;
      break;
    }
  }
  return unescape(markup.slice(tag.end, end).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// The problems in a site, given its published files and a reader.
export function findProblems(files, read) {
  const problems = [];
  const pages = files.filter((f) => /\.html?$/i.test(f));
  for (const f of CSP_PAGES) if (!pages.includes(f)) problems.push(`${f} is not a published page`);
  const parsed = new Map(pages.map((p) => [p, parsePage(read(p))]));
  const gaPages = pages.filter((p) => parsed.get(p).scripts.some((s) => (s.attrs.src ?? "").trim() === GA_LOADER));

  // Google tag hosts and IDs, in every published page and script.
  for (const f of files.filter((x) => /\.(?:html?|m?js)$/i.test(x))) {
    let text = read(f);
    const page = parsed.get(f);
    if (page) {
      const keep = [
        ...page.scripts.filter((s) => (s.attrs.src ?? "").trim() === GA_LOADER).map((s) => [s.index, s.openEnd]),
        ...page.cspTags.map((t) => [t.index, t.end]),
      ];
      for (const [a, b] of keep) text = text.slice(0, a) + blank(text.slice(a, b)) + text.slice(b);
    }
    for (const m of text.matchAll(GOOGLE_HOSTS)) {
      problems.push(`${f}:${lineOf(text, m.index)} names ${m[0]} outside the Google Analytics loader (${GA_LOADER}) and the CSP`);
    }
    for (const m of read(f).matchAll(GOOGLE_TAG_ID)) {
      if (m[0] !== GA_ID) problems.push(`${f}:${lineOf(text, m.index)} names the Google tag ${m[0]}; the only tag the site may load is ${GA_ID}`);
    }
  }

  let cspPages = 0;
  let inline = 0;
  for (const page of pages) {
    const { markup, scripts, tags, cspTags } = parsed.get(page);

    for (const s of scripts) {
      if (!("src" in s.attrs) || s.attrs.src.trim() === GA_LOADER) continue;
      const host = hostOf(s.attrs.src, page);
      if (host !== "self") {
        problems.push(`${page}:${s.line} loads a script from ${host ?? s.attrs.src}; the only script from another host a page may load is ${GA_LOADER}`);
      }
    }

    const cspTag = cspTags[0];
    if (!cspTag) {
      if (CSP_PAGES.includes(page)) problems.push(`${page} has no <meta http-equiv="Content-Security-Policy">`);
      continue;
    }
    cspPages += 1;
    if (cspTags.length > 1) {
      problems.push(`${page}:${cspTags[1].line} has ${cspTags.length} CSP meta tags; keep one, so the browser and this check read the same policy`);
    }

    const charset = tags.find((t) => t.name === "meta" && "charset" in t.attrs);
    const next = charset && tags.find((t) => t.index > charset.index);
    if (!charset) problems.push(`${page} has no <meta charset>, so its CSP meta tag cannot come right after it`);
    else if (next !== cspTag) {
      problems.push(
        `${page}:${cspTag.line} the CSP meta tag must be the first tag after <meta charset> on line ${charset.line}, but <${next ? next.name : "nothing"}> on line ${next ? next.line : charset.line} comes first`,
      );
    }
    const first = tags.find((t) => ["script", "style", "link"].includes(t.name));
    if (first && first.index < cspTag.index) {
      problems.push(`${page}:${cspTag.line} the CSP meta tag comes after the <${first.name}> on line ${first.line}, so it does not cover it`);
    }

    const csp = parseCsp(cspTag.attrs.content || "");
    const directive = (name) => csp[name] ?? csp["default-src"] ?? [];
    const scriptSrc = directive("script-src");
    const scriptHosts = new Set(
      scripts.filter((s) => "src" in s.attrs).map((s) => hostOf(s.attrs.src, page)).filter((h) => h && h !== "self" && h !== "data:"),
    );
    for (const tok of scriptSrc) {
      const ok =
        tok === "'self'" || /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(tok) || (/^https:\/\//.test(tok) && scriptHosts.has(tok.slice(8)));
      if (!ok) problems.push(`${page}: script-src allows ${tok}; use 'self', a sha256 hash, or the host of a script the page loads`);
    }
    const loadsGa = gaPages.includes(page);
    for (const [name, tokens] of Object.entries(csp)) {
      if (name.startsWith("script-src-")) {
        problems.push(`${page}: the CSP sets ${name}, which overrides script-src; put script sources in script-src, which this check reads`);
        continue;
      }
      if (name === "script-src" || !(/-src(?:-elem|-attr)?$/.test(name) || name === "form-action")) continue;
      const allowed = ["'self'", "'none'", ...(SOURCES[name] ?? []), ...((loadsGa && GA_CSP[name]) || [])];
      for (const tok of tokens) {
        if (allowed.includes(tok)) continue;
        if (GA_SOURCES.has(tok) && !loadsGa) problems.push(`${page}: ${name} allows ${tok}, but the page does not load ${GA_LOADER}`);
        else problems.push(`${page}: ${name} allows ${tok}; it may allow only ${allowed.join(" ")}`);
      }
    }
    for (const name of ["object-src", "base-uri"]) {
      const tokens = csp[name] ?? (name === "object-src" ? csp["default-src"] : undefined);
      if (!tokens || tokens.join(" ") !== "'none'") problems.push(`${page}: the CSP must set ${name} 'none'`);
    }

    if (loadsGa) {
      for (const [name, sources] of Object.entries(GA_CSP)) {
        for (const src of sources) {
          if (!directive(name).includes(src)) problems.push(`${page}: the page loads Google Analytics, so ${name} needs ${src} (Google's CSP for GA4)`);
        }
      }
    }

    const hashes = new Set(scriptSrc.filter((t) => t.startsWith("'sha256-")).map((t) => t.slice(1, -1)));
    const needed = new Set();
    for (const s of scripts) {
      if ("src" in s.attrs) {
        const host = hostOf(s.attrs.src, page);
        if (host && !allows(scriptSrc, host)) problems.push(`${page}:${s.line} loads a script from ${host}, which script-src does not allow`);
        continue;
      }
      if (!JS_TYPES.has(typeOf(s.attrs))) continue;
      inline += 1;
      const hash = hashOf(s.body);
      needed.add(hash);
      if (!hashes.has(hash)) problems.push(`${page}:${s.line} has an inline script that script-src does not list: add '${hash}'`);
    }
    for (const h of hashes) if (!needed.has(h)) problems.push(`${page}: script-src lists '${h}', which matches no inline script`);

    const imgSrc = directive("img-src");
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

  // While Google Analytics runs, the privacy notes have to say so.
  if (gaPages.length) {
    for (const page of CSP_PAGES.filter((p) => parsed.has(p))) {
      const { markup, tags } = parsed.get(page);
      const tag = tags.find((t) => t.attrs.id === "privacy");
      const note = tag ? textOf(markup, tag) : "";
      const why = `${gaPages.includes(page) ? "the page" : gaPages[0]} loads Google Analytics`;
      if (!tag) problems.push(`${page} has no privacy note (id="privacy"), but ${why}`);
      else {
        if ("hidden" in tag.attrs || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(tag.attrs.style ?? "")) {
          problems.push(`${page}:${tag.line} the privacy note is hidden, but ${why}`);
        }
        if (!/\buses Google Analytics\b/.test(note)) problems.push(`${page}:${tag.line} the privacy note does not say the site uses Google Analytics, but ${why}`);
        if (/\b(?:not|never|no longer)\s+uses?\s+Google Analytics\b|n['’]t\s+use\s+Google Analytics\b/i.test(note)) {
          problems.push(`${page}:${tag.line} the privacy note says the site does not use Google Analytics, but ${why}`);
        }
        if (/\bno (?:analytics|cookies)\b/i.test(note)) problems.push(`${page}:${tag.line} the privacy note says no analytics or no cookies, but ${why}`);
      }
    }
  }

  return { problems, pages: pages.length, gaPages: gaPages.length, cspPages, inline };
}

// Self-tests: a fixture site that must pass, and edits to it, each of
// which the check must pass or catch.
const OWN = "\n  document.documentElement.className = 'js';\n";
const CONFIG = `\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', '${GA_ID}');\n`;
const GA_TAGS = `<script async src="${GA_LOADER}"></script>\n<script>${CONFIG}</script>\n`;

function fixturePage({ ga = true } = {}) {
  const extra = (name) => (ga ? ` ${GA_CSP[name].join(" ")}` : "");
  const csp = [
    "default-src 'self'",
    `script-src 'self'${extra("script-src")}${ga ? ` '${hashOf(CONFIG)}'` : ""} '${hashOf(OWN)}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https://images.crabcrop.org${extra("img-src")}`,
    `connect-src 'self'${extra("connect-src")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const note = ga
    ? `this site uses Google Analytics to count visits. Google Analytics sets the cookies <code>_ga</code> and <code>_ga_${GA_ID.slice(2)}</code>.`
    : "this site uses no analytics and sets no cookies.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixture</title>
<link rel="icon" href="favicon.svg">
<style>body{margin:0}</style>
${ga ? GA_TAGS : ""}<script src="thumbhash.js"></script>
</head>
<body>
<img src="https://images.crabcrop.org/sig/w:200/root:site/a.jpg" srcset="a.jpg 1x, data:image/png;base64,AAAA 2x" alt="">
<footer>
<p class="signoff" id="privacy">Privacy: ${note} GitHub Pages serves the pages.</p>
</footer>
<script>${OWN}</script>
</body>
</html>
`;
}

const PREVIEW = `<!doctype html>
<html><head><meta charset="utf-8"><title>Old preview</title>
${GA_TAGS}</head><body><p>Old preview</p></body></html>
`;
const GTM_SNIPPET = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-ABC1234');</script>`;

function fixtureSite({ ga = true } = {}) {
  return {
    "index.html": fixturePage({ ga }),
    "docs.html": fixturePage({ ga }),
    "thumbhash.js": "export function thumbHashToDataURL(hash) { return 'data:image/png;base64,' + hash; }\n",
    "preview/old/index.html": ga ? PREVIEW : PREVIEW.replace(GA_TAGS, ""),
  };
}

// Replaces from with to in files[name], and fails when from is absent,
// so an edit cannot silently stop applying.
function edit(files, name, from, to) {
  if (!files[name].includes(from)) throw new Error(`self-test fixture: ${name} has no ${JSON.stringify(from)}`);
  files[name] = files[name].replace(from, to);
}

// [name, base, edit, expected problem (null: none)]
const SELF_TESTS = [
  ["the fixture site, with Google Analytics on every page", {}, () => {}, null],
  ["the fixture site without Google Analytics", { ga: false }, () => {}, null],
  ["a JSON-LD block and another script from the site", {}, (f) => {
    edit(f, "index.html", "</head>", `<script type="application/ld+json">{"@type":"WebSite"}</script>\n<script src="/site.js" defer></script>\n</head>`);
  }, null],
  ["a page without a CSP that loads only the Google Analytics loader", {}, (f) => {
    f["preview/other/index.html"] = PREVIEW;
  }, null],
  ["font-src and form-action 'self'", {}, (f) => edit(f, "docs.html", "form-action 'none'", "font-src 'self'; form-action 'self'"), null],
  ["an edited inline script", {}, (f) => edit(f, "index.html", "className = 'js'", "className = 'js ready'"), "has an inline script that script-src does not list: add"],
  ["a hash that matches no inline script", {}, (f) => edit(f, "docs.html", `<script>${OWN}</script>\n`, ""), "which matches no inline script"],
  ["a sha384 hash, which the check cannot match", {}, (f) => edit(f, "index.html", "script-src 'self'", "script-src 'self' 'sha384-OLqyFJ7xhJBp8iXUQ2ZD4FqW2XEhJ0TQ3vGmLwXk1n3T0xXbWl4bOs5o5zcqWD9G'"), "script-src allows 'sha384-"],
  ["an inline script of a legacy JavaScript type", {}, (f) => edit(f, "docs.html", "</body>", '<script type="application/x-javascript">window.x = 1;</script>\n</body>'), "has an inline script that script-src does not list"],
  ["an inline script with language=\"JavaScript\"", {}, (f) => edit(f, "index.html", "</body>", '<script language="JavaScript">window.x = 1;</script>\n</body>'), "has an inline script that script-src does not list"],
  ["an inline import map", {}, (f) => edit(f, "index.html", "</head>", '<script type="importmap">{"imports":{}}</script>\n</head>'), "has an inline script that script-src does not list"],
  ["an edited Google Analytics config", {}, (f) => edit(f, "docs.html", "gtag('js', new Date());", "gtag('js', new Date());\n  gtag('set', 'ads_data_redaction', true);"), "has an inline script that script-src does not list"],
  ["gtag.js for another property", {}, (f) => edit(f, "index.html", `gtag/js?id=${GA_ID}`, "gtag/js?id=G-0THER0000"), "the only script from another host a page may load is"],
  ["the Google Analytics loader by another URL", {}, (f) => edit(f, "docs.html", `src="${GA_LOADER}"`, `src="//www.googletagmanager.com/gtag/js?id=${GA_ID}"`), "the only script from another host a page may load is"],
  ["a second Google tag in the config", {}, (f) => edit(f, "index.html", `gtag('config', '${GA_ID}');`, `gtag('config', '${GA_ID}');\n  gtag('config', 'AW-123456789');`), "names the Google tag AW-123456789"],
  ["a Google Tag Manager loader in an inline script", {}, (f) => edit(f, "preview/old/index.html", "</body>", `${GTM_SNIPPET}</body>`), "names googletagmanager.com outside the Google Analytics loader"],
  ["a site script that calls google-analytics.com", {}, (f) => {
    f["thumbhash.js"] += "navigator.sendBeacon('https://www.google-analytics.com/g/collect');\n";
  }, "thumbhash.js:2 names google-analytics.com"],
  ["a script from a CDN", {}, (f) => edit(f, "preview/old/index.html", "</head>", '<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"></script></head>'), "loads a script from cdn.jsdelivr.net; the only script"],
  ["no CSP on docs.html", {}, (f) => edit(f, "docs.html", /<meta http-equiv="Content-Security-Policy"[^>]*>\n/.exec(f["docs.html"])[0], ""), 'docs.html has no <meta http-equiv="Content-Security-Policy">'],
  ["a second CSP meta tag", {}, (f) => edit(f, "index.html", "<title>", `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">\n<title>`), "has 2 CSP meta tags"],
  ["the CSP after a <link>", {}, (f) => {
    const tag = /<meta http-equiv="Content-Security-Policy"[^>]*>\n/.exec(f["index.html"])[0];
    edit(f, "index.html", tag, "");
    edit(f, "index.html", '<link rel="icon" href="favicon.svg">\n', `<link rel="icon" href="favicon.svg">\n${tag}`);
  }, "comes after the <link>"],
  ["the CSP after another meta tag", {}, (f) => {
    const tag = /<meta http-equiv="Content-Security-Policy"[^>]*>\n/.exec(f["index.html"])[0];
    edit(f, "index.html", tag, "");
    edit(f, "index.html", "<title>", `${tag}<title>`);
  }, "must be the first tag after <meta charset> on line 4, but <meta> on line 5 comes first"],
  ["no <meta charset>", {}, (f) => edit(f, "docs.html", '<meta charset="utf-8">\n', ""), "docs.html has no <meta charset>"],
  ["an onclick attribute", {}, (f) => edit(f, "index.html", '<p class="signoff"', '<p onclick="go()" class="signoff"'), "inline onclick handler"],
  ["a javascript: URL", {}, (f) => edit(f, "docs.html", "<footer>", '<footer><a href="javascript:void(0)">top</a>'), "has a javascript: URL"],
  ["'unsafe-inline' in script-src", {}, (f) => edit(f, "index.html", "script-src 'self'", "script-src 'self' 'unsafe-inline'"), "script-src allows 'unsafe-inline'"],
  ["'unsafe-eval' in script-src", {}, (f) => edit(f, "docs.html", "script-src 'self'", "script-src 'self' 'unsafe-eval'"), "script-src allows 'unsafe-eval'"],
  ["'unsafe-inline' in script-src-elem", {}, (f) => edit(f, "index.html", "style-src 'self'", "script-src-elem 'self' 'unsafe-inline'; style-src 'self'"), "the CSP sets script-src-elem, which overrides script-src"],
  ["another host in style-src-elem", {}, (f) => edit(f, "docs.html", "style-src 'self'", "style-src-elem 'self' https://fonts.googleapis.com; style-src 'self'"), "style-src-elem allows https://fonts.googleapis.com"],
  ["any host in connect-src", {}, (f) => edit(f, "index.html", "connect-src 'self'", "connect-src * 'self'"), "connect-src allows *; it may allow only"],
  ["any https host in img-src", {}, (f) => edit(f, "docs.html", "img-src 'self'", "img-src https: 'self'"), "img-src allows https:; it may allow only"],
  ["any host in default-src", {}, (f) => edit(f, "docs.html", "default-src 'self'", "default-src *"), "default-src allows *; it may allow only"],
  ["another host in style-src", {}, (f) => edit(f, "index.html", "style-src 'self'", "style-src 'self' https://fonts.googleapis.com"), "style-src allows https://fonts.googleapis.com"],
  ["Google's wildcard in script-src", {}, (f) => edit(f, "index.html", "script-src 'self' https://www.googletagmanager.com", "script-src 'self' https://*.googletagmanager.com"), "script-src allows https://*.googletagmanager.com"],
  ["the loader's host missing from script-src", {}, (f) => edit(f, "docs.html", "script-src 'self' https://www.googletagmanager.com", "script-src 'self'"), "loads a script from www.googletagmanager.com, which script-src does not allow"],
  ["a GA host missing from connect-src", {}, (f) => edit(f, "index.html", " https://*.analytics.google.com", ""), "connect-src needs https://*.analytics.google.com"],
  ["a GA host missing from img-src", {}, (f) => edit(f, "docs.html", "https://images.crabcrop.org https://*.google-analytics.com", "https://images.crabcrop.org"), "img-src needs https://*.google-analytics.com"],
  ["GA's host left in script-src without GA", { ga: false }, (f) => edit(f, "index.html", "script-src 'self'", "script-src 'self' https://www.googletagmanager.com"), "script-src allows https://www.googletagmanager.com"],
  ["GA's hosts left in connect-src without GA", { ga: false }, (f) => edit(f, "docs.html", "connect-src 'self'", "connect-src 'self' https://*.google-analytics.com"), "connect-src allows https://*.google-analytics.com, but the page does not load https://www.googletagmanager.com/gtag/js"],
  ["object-src dropped", {}, (f) => edit(f, "index.html", " object-src 'none';", ""), "the CSP must set object-src 'none'"],
  ["base-uri dropped", {}, (f) => edit(f, "docs.html", " base-uri 'none';", ""), "the CSP must set base-uri 'none'"],
  ["an image from another host", {}, (f) => edit(f, "index.html", "<footer>", '<footer><img src="https://example.com/x.png" alt="">'), "loads an image from example.com, which img-src does not allow"],
  ["a note that says no analytics while GA runs", {}, (f) => edit(f, "docs.html", "this site uses Google Analytics to count visits. Google Analytics sets", "this site uses no analytics and sets no cookies. A counter sets"), "the privacy note does not say the site uses Google Analytics"],
  ["a note that names GA but says no cookies", {}, (f) => edit(f, "index.html", "Google Analytics sets the cookies", "Google Analytics sets no cookies, unlike"), "the privacy note says no analytics or no cookies"],
  ["a note that says the site does not use GA", {}, (f) => edit(f, "docs.html", "this site uses Google Analytics", "this site does not use Google Analytics"), "the privacy note says the site does not use Google Analytics"],
  ["a note that says the site no longer uses GA", {}, (f) => edit(f, "index.html", "this site uses Google Analytics", "this site no longer uses Google Analytics"), "the privacy note says the site does not use Google Analytics"],
  ["a hidden privacy note", {}, (f) => edit(f, "docs.html", ' id="privacy"', ' id="privacy" hidden'), "the privacy note is hidden"],
  ["a privacy note styled out of sight", {}, (f) => edit(f, "index.html", ' id="privacy"', ' id="privacy" style="display: none"'), "the privacy note is hidden"],
  ["no privacy note while GA runs", {}, (f) => edit(f, "index.html", ' id="privacy"', ""), 'index.html has no privacy note (id="privacy"), but the page loads Google Analytics'],
  ["GA only on an old preview, and notes that say no analytics", { ga: false }, (f) => {
    f["preview/old/index.html"] = PREVIEW;
  }, "the privacy note does not say the site uses Google Analytics, but preview/old/index.html loads Google Analytics"],
];

export function selfTest() {
  const failures = [];
  for (const [name, base, change, expected] of SELF_TESTS) {
    const files = fixtureSite(base);
    try {
      change(files);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
      continue;
    }
    const { problems } = findProblems(Object.keys(files), (f) => files[f]);
    if (expected === null && problems.length) failures.push(`${name}: expected no problem, got\n       ${problems.join("\n       ")}`);
    if (expected !== null && !problems.some((p) => p.includes(expected))) {
      failures.push(`${name}: expected a problem with "${expected}", got\n       ${problems.join("\n       ") || "none"}`);
    }
  }
  const passes = SELF_TESTS.filter((t) => t[3] === null).length;
  return { failures, total: SELF_TESTS.length, passes };
}

export function checkScripts(site) {
  const tests = selfTest();
  for (const f of tests.failures) console.error(`FAIL self-test ${f}`);
  if (!tests.failures.length) {
    console.log(`ok   ${tests.total} self-tests: ${tests.passes} fixture sites pass, and each of ${tests.total - tests.passes} broken ones fails`);
  }

  const r = findProblems(publishedFiles(site), (f) => readFileSync(join(site, f), "utf8"));
  if (r.problems.length) {
    for (const p of r.problems) console.error(`FAIL ${p}`);
    console.error(`\n${r.problems.length} script or CSP problem(s) in ${site}`);
    return false;
  }
  console.log(`ok   ${r.pages} published pages load no script from another host but the Google Analytics loader (${r.gaPages} load it)`);
  console.log(`ok   ${r.cspPages} pages carry a CSP right after <meta charset> that lists their ${r.inline} inline scripts and every script and image host, and allows no other source`);
  if (r.gaPages) console.log(`ok   the privacy notes on ${CSP_PAGES.join(" and ")} say the site uses Google Analytics`);
  return tests.failures.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const site = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  if (!existsSync(join(site, "index.html"))) {
    console.error("usage: node .github/site-checks/scripts.mjs [site-checkout]");
    process.exit(2);
  }
  process.exit(checkScripts(site) ? 0 : 1);
}
