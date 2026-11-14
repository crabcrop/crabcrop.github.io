// Check that the site publishes no image its pages do not use, no
// preview but the dive and no notes, and that its pages use no local
// file the site does not have.
//
// GitHub Pages serves every tracked file that Jekyll does not exclude,
// so an image that index.html and docs.html never load is dead weight
// anyone can fetch. The check fails when
//   - a published image is referenced by no page,
//   - a page references a local file that Pages does not publish,
//   - a file under preview/ is published outside preview/dive/,
//   - or a Markdown file is published.
//
// preview/dive/ is the one preview the site publishes on purpose: the
// "All the Way Down" dive, built from experience/. Its own scripts load
// its media, so its images need no page reference. Its index.html is
// scanned like a page, so the site files it uses count as used and must
// exist.
//
// Published means tracked (git ls-files) and not left out by Jekyll:
// no path segment starts with ".", "_", "#" or ends with "~", and no
// path is under an exclude entry of _config.yml.
//
// A reference is
//   - a src, href, srcset, imagesrcset, poster, or content attribute of
//     a real tag, every entry of a srcset included (the *-still.webp
//     frames are the srcset of a reduced-motion <source>),
//   - a CSS url() in a <style> block, a style attribute, or a local
//     stylesheet the page links,
//   - an images.crabcrop.org URL anywhere on the page, which counts for
//     the file after root:site/: the image server renders that original
//     from this site, so it has to stay published.
// URLs on crabcrop.org count as local. Markup inside HTML comments does
// not count, and neither does escaped markup in code samples.
//
// Usage:
//   node .github/site-checks/assets.mjs [site-checkout]
// The checkout defaults to the repository this script is in.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const PAGES = ["index.html", "docs.html"];
// The one preview the site publishes. Nothing else may sit under preview/.
const PREVIEW = "preview/dive/";
const ORIGIN = "https://crabcrop.org/";
const SITE_HOSTS = new Set(["crabcrop.org", "www.crabcrop.org"]);
const IMAGE_SERVER = "images.crabcrop.org";
const IMAGE = /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|jxl|png|svg|tiff?|webp)$/i;
const URL_ATTRS = new Set(["src", "href", "xlink:href", "poster", "content"]);
const SRCSET_ATTRS = new Set(["srcset", "imagesrcset"]);

if (!PAGES.every((p) => existsSync(join(SITE, p)))) {
  console.error("usage: node .github/site-checks/assets.mjs [site-checkout]");
  process.exit(2);
}

const tracked = new Set(
  execFileSync("git", ["-C", SITE, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean),
);

// The exclude list of _config.yml: the "- entry" lines under "exclude:".
function excludes() {
  const config = join(SITE, "_config.yml");
  if (!existsSync(config)) return [];
  const out = [];
  let inList = false;
  for (const line of readFileSync(config, "utf8").split("\n")) {
    if (/^exclude:\s*(?:#.*)?$/.test(line)) inList = true;
    else if (inList && /^\s*-\s*/.test(line)) out.push(line.replace(/^\s*-\s*|\s*(?:#.*)?$/g, "").replace(/^["']|["']$/g, "").replace(/\/$/, ""));
    else if (inList && /^\S/.test(line)) inList = false;
  }
  return out;
}
const EXCLUDE = excludes();
const published = new Set(
  [...tracked].filter(
    (f) =>
      !f.split("/").some((seg) => /^[._#]/.test(seg) || seg.endsWith("~")) &&
      !EXCLUDE.some((e) => f === e || f.startsWith(`${e}/`)),
  ),
);
const pages = PAGES.concat(published.has(`${PREVIEW}index.html`) ? [`${PREVIEW}index.html`] : []);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
function unescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Blank out a match but keep its newlines, so offsets still give lines.
const blank = (s) => s.replace(/[^\n]/g, " ");
// lines(text)(index) is the 1-based line of an offset in text.
function lines(text) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// The site path a reference names, or null when it is not on the site.
function sitePath(ref, base) {
  let url;
  try {
    url = new URL(ref.trim(), ORIGIN + base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  let path;
  if (url.hostname === IMAGE_SERVER) {
    const at = url.pathname.indexOf("/root:site/");
    if (at < 0) return null;
    path = url.pathname.slice(at + "/root:site/".length);
  } else if (SITE_HOSTS.has(url.hostname)) {
    path = url.pathname.slice(1);
    if (path === "" || path.endsWith("/")) path += "index.html";
  } else {
    return null;
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// The candidate URLs of a srcset, without their width or density
// descriptors. A URL may hold commas; a candidate ends at whitespace.
function srcsetUrls(value) {
  const urls = [];
  let rest = value;
  for (;;) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) return urls;
    let url = /^\S+/.exec(rest)[0];
    rest = rest.slice(url.length);
    if (/,$/.test(url)) {
      url = url.replace(/,+$/, "");
    } else {
      const comma = rest.indexOf(",");
      rest = comma < 0 ? "" : rest.slice(comma + 1);
    }
    urls.push(url);
  }
}

const cssUrls = (css) => [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/g)].map((m) => ({
  ref: m[1] ?? m[2] ?? m[3],
  index: m.index,
}));

// Every reference: { from, line, ref, path }, path null when off-site.
const refs = [];
const add = (from, line, ref, base) => {
  if (ref && ref.trim()) refs.push({ from, line, ref, path: sitePath(ref, base) });
};
const stylesheets = new Set();

for (const page of pages) {
  const raw = readFileSync(join(SITE, page), "utf8");
  const text = raw.replace(/<!--[\s\S]*?-->/g, blank);
  const lineAt = lines(text);

  // images.crabcrop.org URLs anywhere: tags, scripts, code samples.
  for (const m of text.matchAll(/https?:\/\/images\.crabcrop\.org\/[^\s"'<>`]*?\/root:site\/[^\s"'<>`()?#&]+/g)) {
    add(page, lineAt(m.index), m[0], page);
  }

  // <style> blocks: CSS url().
  for (const m of text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) {
    const start = m.index + m[1].length;
    for (const u of cssUrls(m[2])) add(page, lineAt(start + u.index), u.ref, page);
  }

  // Real tags. Script and style bodies are blanked first, so a "<" in
  // code is not read as a tag; escaped markup in <pre> is "&lt;" and
  // never matches.
  const markup = text.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (m, open, name, body, close) => open + blank(body) + close,
  );
  const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const tag of markup.matchAll(TAG)) {
    const line = lineAt(tag.index);
    const attrs = {};
    for (const a of tag[2].matchAll(ATTR)) attrs[a[1].toLowerCase()] = unescape(a[2] ?? a[3] ?? a[4] ?? "");
    for (const [name, value] of Object.entries(attrs)) {
      if (URL_ATTRS.has(name)) {
        // content= is a URL only on meta tags like og:image.
        if (name === "content" && !/^https?:\/\//i.test(value.trim())) continue;
        add(page, line, value, page);
      } else if (SRCSET_ATTRS.has(name)) {
        for (const url of srcsetUrls(value)) add(page, line, url, page);
      } else if (name === "style") {
        for (const u of cssUrls(value)) add(page, line, u.ref, page);
      }
    }
    if (tag[1].toLowerCase() === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(attrs.rel || "")) {
      const path = sitePath(attrs.href || "", page);
      if (path) stylesheets.add(path);
    }
  }
}

// Linked local stylesheets: their url()s resolve against the sheet.
for (const sheet of stylesheets) {
  if (!published.has(sheet)) continue; // reported below as a missing file
  const css = readFileSync(join(SITE, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, blank);
  const lineAt = lines(css);
  for (const u of cssUrls(css)) add(sheet, lineAt(u.index), u.ref, sheet);
}

const problems = [];
const exists = (path) => published.has(path) || published.has(`${path}.html`) || published.has(`${path}/index.html`);
const missing = new Map();
for (const r of refs) {
  if (r.path === null || exists(r.path)) continue;
  if (!missing.has(r.path)) missing.set(r.path, r);
}
for (const [path, r] of missing) {
  const via = r.ref.trim() === path ? "" : ` (${r.ref.trim()})`;
  problems.push(`${r.from}:${r.line} references ${path}, which is not a published file${via}`);
}

const used = new Set(refs.map((r) => r.path).filter(Boolean));
const images = [...published].filter((f) => IMAGE.test(f) && !f.startsWith(PREVIEW)).sort();
const unused = images.filter((f) => !used.has(f));
for (const f of unused) {
  const bytes = existsSync(join(SITE, f)) ? statSync(join(SITE, f)).size : 0;
  problems.push(`${f} (${bytes.toLocaleString("en-US")} B) is published but no page references it`);
}

const strays = [...published].filter((f) => f.startsWith("preview/") && !f.startsWith(PREVIEW)).sort();
for (const f of strays) problems.push(`${f} is published, but ${PREVIEW} is the only preview the site serves`);
const notes = [...published].filter((f) => /\.(?:md|markdown)$/i.test(f)).sort();
for (const f of notes) problems.push(`${f} is a notes file that Pages publishes`);

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(
    `\n${unused.length} unreferenced image(s), ${missing.size} missing file(s), ` +
      `${strays.length} stray preview file(s), ${notes.length} published notes file(s) in ${SITE}` +
      (unused.length ? "\nDelete an unused image (git history keeps it), or reference it from a page." : "") +
      (strays.length || notes.length
        ? "\nDelete the file (git history keeps it), or move it under a folder that _config.yml excludes."
        : ""),
  );
  process.exit(1);
}
const local = new Set(refs.filter((r) => r.path !== null).map((r) => r.path));
const dive = [...published].filter((f) => f.startsWith(PREVIEW)).length;
console.log(`ok   all ${images.length} published images outside ${PREVIEW} are referenced by ${pages.join(", ")}`);
console.log(`ok   all ${local.size} local files the pages reference are published`);
console.log(`ok   ${PREVIEW} (${dive} files) is the only preview published, and no notes file is published`);
