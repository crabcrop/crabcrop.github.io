// Check that the site publishes no image its pages do not use, no file
// of the dive that the dive does not use, no preview but the dive and
// the home preview and no notes, and that its pages and the dive's
// scripts use no local file the site does not have.
//
// GitHub Pages serves every tracked file that Jekyll does not exclude,
// so a file nothing loads is dead weight anyone can fetch. The check
// fails when
//   - a published image outside preview/dive/ is referenced by no page,
//   - a published file under preview/dive/, of any type, is used by
//     neither the dive's page, its stylesheets nor its scripts,
//   - a page, or a script of the dive, references a local file that
//     Pages does not publish,
//   - a file under preview/ is published outside preview/dive/ and
//     preview/home/,
//   - or a Markdown file is published.
//
// The site publishes two previews on purpose. preview/home/ is a
// candidate for the next home page, written by hand (its notes are in
// design/home/). It is plain HTML, so its images are held to the same
// rule as the site's: each one has to be referenced. preview/dive/ is
// the "All the Way Down" dive, built from experience/: its page, the
// bundles the build writes next to it, and the media its scripts load.
// Every file there has to be used, whatever its type. The index.html of
// each preview is scanned like a page, so the site files it uses count
// as used and must exist.
//
// Published means tracked (git ls-files) and not left out by Jekyll:
// no path segment starts with ".", "_", "#" or ends with "~", and no
// path is under an exclude entry of _config.yml.
//
// A reference from a page is
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
// The dive's scripts are the ones its page runs, inline or by src, and
// the scripts those name. They build most of their file names as they
// run (`snap-${clip}.mp4`), so their strings are read with a small
// JavaScript tokenizer, and comments, regular expressions and the keys
// of object literals do not count: the media manifest the dive inlines
// lists what was encoded, not what the page loads. A string names files
// relative to the script's folder, the page's folder, or a folder the
// scripts name ("media/", which the dive's names resolve against):
//   - a relative path with a file extension names that file, which must
//     be published (a chunk such as "./world-<hash>.js", "snap-3d.txt"),
//     and a script it names is read too;
//   - any string names the files it spells without their extensions
//     ("print" for print.avif and print.webp, "z0-loop" for
//     z0-loop.av1.mp4: the loaders add the one the browser takes), and
//     a picture in several widths, name-width, when the width is a
//     number in the scripts ("z0u" and 2400 for z0u-2400.webp);
//   - a template literal names every file its fixed text fits, each
//     substitution standing for characters other than a slash
//     (`${zone}/${dev}-pack${i}.avif` for t2/d-pack0.avif), when that
//     text pins the name: a letter or digit in its last path segment
//     besides the extension, so `${name}.${ext}` names nothing.
// That errs toward keeping files: a string that only happens to match a
// name keeps its file, but a file that no string of the dive can name
// fails.
//
// Before it checks the site, it runs its self-tests: fixture sites it
// must pass, and broken ones it must catch.
//
// Usage:
//   node .github/site-checks/assets.mjs [site-checkout]
// The checkout defaults to the repository this script is in.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAGES = ["index.html", "docs.html"];
// The previews the site publishes. Nothing else may sit under preview/.
// Every file of the dive has to be used by its page or its scripts.
const DIVE = "preview/dive/";
const DIVE_PAGE = `${DIVE}index.html`;
const PREVIEWS = [DIVE, "preview/home/"];
const ORIGIN = "https://crabcrop.org/";
const SITE_HOSTS = new Set(["crabcrop.org", "www.crabcrop.org"]);
const IMAGE_SERVER = "images.crabcrop.org";
const IMAGE = /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|jxl|png|svg|tiff?|webp)$/i;
const URL_ATTRS = new Set(["src", "href", "xlink:href", "poster", "content"]);
const SRCSET_ATTRS = new Set(["srcset", "imagesrcset"]);
// A string in a script that names a file: a relative path (no scheme,
// no leading slash) with an extension of something a page loads.
const FILE_NAME =
  /^(?:\.{1,2}\/)*(?:[\w-]+\/)*[\w-][\w.-]*\.(?:avif|bmp|css|gif|glb|gltf|html?|ico|jpe?g|js|json|jxl|mjs|mp3|mp4|ogg|otf|png|svg|ttf|txt|wasm|wav|webm|webp|woff2?)$/i;
// A string in a script that names a folder: a relative path ending in "/".
const FOLDER_NAME = /^(?:\.\/)?(?:[\w-]+\/)+$/;
const SCRIPT = /\.m?js$/i;
// The <script> types a browser runs as JavaScript.
const JS_TYPE = /^(?:|module|(?:application|text)\/(?:x-)?(?:java|ecma)script)$/i;

// The files Pages publishes: the tracked files minus what Jekyll leaves
// out, given the text of _config.yml.
export function publishedFiles(tracked, config = "") {
  const exclude = [];
  let inList = false;
  for (const line of config.split("\n")) {
    if (/^exclude:\s*(?:#.*)?$/.test(line)) inList = true;
    else if (inList && /^\s*-\s*/.test(line)) exclude.push(line.replace(/^\s*-\s*|\s*(?:#.*)?$/g, "").replace(/^["']|["']$/g, "").replace(/\/$/, ""));
    else if (inList && /^\S/.test(line)) inList = false;
  }
  return tracked.filter(
    (f) =>
      !f.split("/").some((seg) => /^[._#]/.test(seg) || seg.endsWith("~")) &&
      !exclude.some((e) => f === e || f.startsWith(`${e}/`)),
  );
}

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

// The strings, template literals and integer literals of a script, read
// with just enough of JavaScript's grammar to skip comments and regular
// expressions and to tell the key of an object literal from a value. A
// template literal without substitutions is a string; one with them is
// its fixed parts. It throws on a string, template, comment or regular
// expression that does not end, so a script it cannot read fails the
// check instead of passing it.
const BEFORE_EXPRESSION = new Set(["await", "case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield"]);
const PUNCTUATOR =
  /^(?:>>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|\?\?=|&&=|\|\|=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.(?!\d)|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\*\*|[-+*/%=<>!~^&|?:;,.()[\]#@])/;
const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/;
const SPACE = /[\s\ufeff]/;
const LINE_END = /[\n\r\u2028\u2029]/g;
const NAME_PART = /[\w$\\]/;
const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
const cook = (raw) =>
  raw.replace(/\\(?:u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|x([\da-fA-F]{2})|(\r\n|[\s\S]))/g, (m, cp, u, x, c) => {
    if (cp) return String.fromCodePoint(Math.min(parseInt(cp, 16), 0x10ffff));
    if (u || x) return String.fromCharCode(parseInt(u || x, 16));
    return /^(?:\r\n|[\n\r\u2028\u2029])$/.test(c) ? "" : (ESCAPES[c] ?? c);
  });

export function scanScript(code) {
  const strings = []; // { value, index }, without the keys of object literals
  const templates = []; // { parts, index }, the ones with substitutions
  const numbers = new Set();
  const braces = []; // per open brace: "{", or "${" for a substitution
  const open = []; // the templates whose substitution is open
  const n = code.length;
  let prev = null; // the last token: { type, value }
  let i = code.startsWith("#!") ? code.indexOf("\n") >>> 0 : 0;
  const fail = (what, at) => {
    throw new Error(`${what} at line ${code.slice(0, at).split("\n").length}`);
  };
  // Template text from i up to the closing backtick (true) or a "${" (false).
  const text = (t) => {
    const start = i;
    for (;;) {
      if (i >= n) fail("a template literal that does not end", t.index);
      const c = code[i];
      if (c === "\\") i += 2;
      else if (c === "`" || (c === "$" && code[i + 1] === "{")) {
        t.parts.push(cook(code.slice(start, i)));
        i += c === "`" ? 1 : 2;
        return c === "`";
      } else i += 1;
    }
  };
  const ended = (t) => {
    if (t.parts.length === 1) strings.push({ value: t.parts[0], index: t.index });
    else templates.push(t);
    prev = { type: "string" };
  };
  const regexOk = () =>
    !prev ||
    (prev.type === "name" && BEFORE_EXPRESSION.has(prev.value)) ||
    (prev.type === "punct" && prev.value !== ")" && prev.value !== "]");
  while (i < n) {
    const c = code[i];
    if (SPACE.test(c)) {
      i += 1;
    } else if (c === "/" && code[i + 1] === "/") {
      LINE_END.lastIndex = i;
      i = LINE_END.exec(code)?.index ?? n;
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end < 0) fail("a comment that does not end", i);
      i = end + 2;
    } else if (c === "'" || c === '"') {
      const start = i;
      for (i += 1; i < n && code[i] !== c; i += 1) {
        if (code[i] === "\\") i += 1;
        else if (code[i] === "\n") fail("a string that does not end", start);
      }
      if (i >= n) fail("a string that does not end", start);
      i += 1;
      let j = i;
      while (j < n && SPACE.test(code[j])) j += 1;
      const key = prev?.type === "punct" && (prev.value === "{" || prev.value === ",") && code[j] === ":";
      if (!key) strings.push({ value: cook(code.slice(start + 1, i - 1)), index: start });
      prev = { type: "string" };
    } else if (c === "`") {
      const t = { parts: [], index: i };
      i += 1;
      if (text(t)) ended(t);
      else {
        open.push(t);
        braces.push("${");
        prev = { type: "punct", value: "${" };
      }
    } else if (c === "{") {
      braces.push("{");
      i += 1;
      prev = { type: "punct", value: "{" };
    } else if (c === "}") {
      i += 1;
      if (braces.pop() !== "${") prev = { type: "punct", value: "}" };
      else if (text(open[open.length - 1])) ended(open.pop());
      else {
        braces.push("${");
        prev = { type: "punct", value: "${" };
      }
    } else if (c === "/" && regexOk()) {
      const start = i;
      let inClass = false;
      for (i += 1; ; i += 1) {
        if (i >= n || code[i] === "\n") fail("a regular expression that does not end", start);
        if (code[i] === "\\") i += 1;
        else if (inClass) inClass = code[i] !== "]";
        else if (code[i] === "[") inClass = true;
        else if (code[i] === "/") break;
      }
      i += 1;
      while (i < n && NAME_PART.test(code[i])) i += 1;
      prev = { type: "regex" };
    } else if (/\d/.test(c) || (c === "." && /\d/.test(code[i + 1] ?? ""))) {
      const m = NUMBER.exec(code.slice(i, i + 80));
      if (/^\d+$/.test(m[0])) numbers.add(String(Number(m[0])));
      i += m[0].length;
      prev = { type: "number" };
    } else if (NAME_PART.test(c) || c.charCodeAt(0) > 0x7f) {
      const start = i;
      while (i < n && (NAME_PART.test(code[i]) || (code.charCodeAt(i) > 0x7f && !SPACE.test(code[i])))) i += 1;
      // After "." a name is a property, never a keyword: a.return / 2.
      const property = prev?.type === "punct" && (prev.value === "." || prev.value === "?.");
      prev = { type: "name", value: property ? "" : code.slice(start, i) };
    } else {
      const m = PUNCTUATOR.exec(code.slice(i, i + 4));
      if (!m) fail(`an unexpected ${JSON.stringify(c)}`, i);
      i += m[0].length;
      prev = { type: "punct", value: m[0] };
    }
  }
  if (open.length) fail("a template substitution that does not end", open[open.length - 1].index);
  return { strings, templates, numbers };
}

const folderOf = (path) => path.slice(0, path.lastIndexOf("/") + 1);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A file name without its extensions: t2/d-pack0.avif is t2/d-pack0,
// z0-loop.av1.mp4 is z0-loop.
const stem = (name) => name.replace(/^((?:.*\/)?[^./]*)\..*$/, "$1");

// The problems of a site, given its published files, a reader and the
// size of a file.
export function findProblems(files, read, size = () => 0) {
  const published = new Set(files);
  const pages = PAGES.concat(PREVIEWS.map((p) => `${p}index.html`).filter((p) => published.has(p)));
  const problems = PAGES.filter((p) => !published.has(p)).map((p) => `${p} is not a published page`);

  // Every reference: { from, line, ref, path }, path null when off-site.
  const refs = [];
  const add = (from, line, ref, base) => {
    if (ref && ref.trim()) refs.push({ from, line, ref, path: sitePath(ref, base) });
  };
  const stylesheets = new Set();
  // The dive's scripts: { path, code, base, line }, base the URL its
  // relative names resolve against, line the page line it starts on.
  const diveScripts = [];

  for (const page of pages.filter((p) => published.has(p))) {
    const raw = read(page);
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
      if (page === DIVE_PAGE && tag[1].toLowerCase() === "script" && "src" in attrs) {
        const path = sitePath(attrs.src, page);
        if (path && published.has(path)) diveScripts.push({ path, code: null, base: path, line: 1 });
      }
    }

    // The dive page's inline scripts.
    if (page === DIVE_PAGE) {
      for (const m of text.matchAll(/(<script\b([^>]*)>)([\s\S]*?)<\/script\s*>/gi)) {
        const attrs = {};
        for (const a of m[2].matchAll(ATTR)) attrs[a[1].toLowerCase()] = unescape(a[2] ?? a[3] ?? a[4] ?? "");
        if ("src" in attrs || !JS_TYPE.test((attrs.type ?? "").trim())) continue;
        diveScripts.push({ path: page, code: m[3], base: page, line: lineAt(m.index + m[1].length) });
      }
    }
  }

  // Linked local stylesheets: their url()s resolve against the sheet.
  for (const sheet of stylesheets) {
    if (!published.has(sheet)) continue; // reported below as a missing file
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, blank);
    const lineAt = lines(css);
    for (const u of cssUrls(css)) add(sheet, lineAt(u.index), u.ref, sheet);
  }

  // The dive's scripts, and the scripts they name, read for the names
  // of files. A relative path with an extension is looked up against
  // the script's own URL, the page's folder and the folders the scripts
  // name; the rest is matched against the dive's files below.
  const names = []; // { from, line, value, base }: relative paths with an extension
  const strings = new Set();
  const templates = [];
  const numbers = new Set();
  const folders = new Set([DIVE]);
  const scanned = new Set();
  let inline = 0;
  for (let k = 0; k < diveScripts.length; k += 1) {
    const s = diveScripts[k];
    if (s.code === null && scanned.has(s.path)) continue;
    if (s.code === null) scanned.add(s.path);
    else inline += 1;
    const code = s.code ?? read(s.path);
    const lineAt = lines(code);
    let found;
    try {
      found = scanScript(code);
    } catch (e) {
      problems.push(`${s.path}:${s.line} could not be read as a script (${e.message}), so the files it names are unknown`);
      continue;
    }
    for (const { value, index } of found.strings) {
      strings.add(value);
      const line = s.line + lineAt(index) - 1;
      if (FOLDER_NAME.test(value)) {
        const folder = sitePath(value, DIVE_PAGE);
        if (folder) folders.add(folder.replace(/index\.html$/, ""));
      } else if (FILE_NAME.test(value)) {
        names.push({ from: s.path, line, value, base: s.base });
        const path = sitePath(value, s.base);
        if (path && SCRIPT.test(path) && published.has(path) && path.startsWith(DIVE)) {
          diveScripts.push({ path, code: null, base: path, line: 1 });
        }
      }
    }
    templates.push(...found.templates);
    for (const x of found.numbers) numbers.add(x);
    folders.add(folderOf(s.path));
  }
  const used = new Set();
  const unnamed = new Map();
  for (const name of names) {
    const candidates = [sitePath(name.value, name.base), ...[...folders].map((f) => sitePath(name.value, f))].filter(Boolean);
    const hits = candidates.filter((p) => published.has(p));
    for (const p of hits) used.add(p);
    const key = `${name.from}\0${name.value}`;
    if (!hits.length && !unnamed.has(key)) unnamed.set(key, { ...name, candidates });
  }
  for (const { from, line, value, candidates } of unnamed.values()) {
    const where = [...new Set(candidates.map(folderOf))];
    problems.push(`${from}:${line} names ${value}, but no published file has that name in ${where.join(", ")}`);
  }

  // The templates that can spell a path and pin its name: fixed text of
  // path characters only, with a letter or digit in the last segment
  // besides a fixed extension.
  const patterns = templates
    .filter((t) => {
      if (!t.parts.every((p) => /^[\w./@~+%-]*$/.test(p))) return false;
      const name = t.parts.join("\0");
      return /[a-z\d]/i.test(name.slice(name.lastIndexOf("/") + 1).replace(/\.[a-z\d]+$/i, "").replace(/\0/g, ""));
    })
    .map((t) => new RegExp(`^${t.parts.map(escapeRegExp).join("[^/]*")}$`));
  // Whether a dive file is named by a string or a template of its scripts.
  const named = (file) =>
    [...folders].some((folder) => {
      if (!file.startsWith(folder)) return false;
      const rel = file.slice(folder.length);
      const bare = stem(rel);
      const width = /^(.*)-(\d+)$/.exec(bare);
      return (
        strings.has(rel) ||
        strings.has(bare) ||
        (width && strings.has(width[1]) && numbers.has(String(Number(width[2])))) ||
        patterns.some((re) => re.test(rel) || re.test(bare))
      );
    });

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

  const local = new Set([...used, ...refs.filter((r) => r.path !== null).map((r) => r.path)]);
  for (const r of refs) if (r.path) used.add(r.path);
  const images = files.filter((f) => IMAGE.test(f) && !f.startsWith(DIVE)).sort();
  const unused = images.filter((f) => !used.has(f));
  for (const f of unused) problems.push(`${f} (${size(f).toLocaleString("en-US")} B) is published but no page references it`);

  const dive = files.filter((f) => f.startsWith(DIVE) && f !== DIVE_PAGE).sort();
  const idle = dive.filter((f) => !used.has(f) && !named(f));
  for (const f of idle) {
    problems.push(`${f} (${size(f).toLocaleString("en-US")} B) is published, but neither ${DIVE_PAGE} nor its stylesheets or scripts use it`);
  }

  const strays = files.filter((f) => f.startsWith("preview/") && !PREVIEWS.some((p) => f.startsWith(p))).sort();
  for (const f of strays) problems.push(`${f} is published, but the site serves no preview besides ${PREVIEWS.join(" and ")}`);
  const notes = files.filter((f) => /\.(?:md|markdown)$/i.test(f)).sort();
  for (const f of notes) problems.push(`${f} is a notes file that Pages publishes`);

  return {
    problems,
    pages,
    images: images.length,
    unused: unused.length,
    dive: dive.length,
    idle: idle.length,
    scripts: scanned.size + inline,
    missing: missing.size + unnamed.size,
    local: local.size + unnamed.size,
    strays: strays.length,
    notes: notes.length,
    count: (p) => files.filter((f) => f.startsWith(p)).length,
  };
}

// Self-tests: a fixture site that must pass, and edits to it, each of
// which the check must pass or catch. The dive in it is built like the
// real one: a page, a module script that imports a second one, and
// media named by strings, a picture in widths and templates.
const FIXTURE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fixture</title>
<meta property="og:image" content="https://crabcrop.org/og.png">
<link rel="stylesheet" href="site.css">
<style>.hero{background:url("hero.jpg")}</style>
</head>
<body>
<picture><source media="(prefers-reduced-motion: reduce)" srcset="snap-still.webp"><img src="https://images.crabcrop.org/0123abcd/preset:site-anim/root:site/snap.webp" alt=""></picture>
<img src="photo.jpg" srcset="photo.jpg 1x, photo-2x.jpg 2x" alt="">
<a href="docs.html">Docs</a> <a href="preview/dive/">Dive</a>
<!-- <img src="gone.png"> -->
<pre>&lt;img src="sample.png"&gt;</pre>
<script src="thumbhash.js"></script>
</body>
</html>
`;
const DIVE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Dive</title>
<link rel="icon" href="/favicon.svg">
<script>(function (d) { d.classList.replace('no-js', 'js'); })(document.documentElement)</script>
<link rel="preload" as="font" type="font/woff2" href="./assets/font-Dd4.woff2" crossorigin>
<script type="module" crossorigin src="./assets/index-Aa1.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-Cc3.css">
</head>
<body>
<picture><source type="image/avif" srcset="media/z0-1600.avif 1600w"><img src="media/z0-1600.webp" alt=""></picture>
</body>
</html>
`;
const DIVE_INDEX = [
  "/*! a bundle */",
  "var m={plates:{z0u:{w:4435,h:1344,widths:[2400,3200]}},seagrass:{w:714,h:900},\"rope-buoy\":{w:669,h:640},loops:{\"z0-loop\":{h264:1,av1:2}}};",
  "var f=new URL(`media/`,document.baseURI),p=e=>new URL(e,f).href,x={av1:`.av1.mp4`,h264:`.mp4`};",
  "async function g(){return!0}async function pic(e){return p(`${e}.${await g()?`avif`:`webp`}`)}",
  "fetch(p(`snap-3d.txt`));pic(`print`);",
  "export async function world(){let{World:e}=await import(`./world-Bb2.js`);return e}",
  "export{m as manifest,p as url,pic};",
  "",
].join("\n");
const DIVE_WORLD = [
  "import{manifest as e,url as v,pic as f}from\"./index-Aa1.js\";",
  "var Wl={z0:[`z0`,`z0p`],z0u:[`z0u`,`z0up`]};",
  "for(let t of[`m01`,`m02`])document.createElement(`video`).src=v(`snap-${t}.mp4`);",
  "f(`${Wl.z0u[0]}-${e.plates.z0u.widths[0]}`);",
  "new Audio(v(`${`z0`}-loop`+(1?`.av1.mp4`:`.mp4`)));",
  "fetch(v(`${`t2`}/${`d`}-pack${0}.avif`));",
  "var q=/[\"'`]/g,r=e=>e.replace(/\\/\\//g,`/`);",
  "",
].join("\n");
const FIXTURE_CONFIG = "exclude:\n  - design\n";

function fixtureSite() {
  return {
    "_config.yml": FIXTURE_CONFIG,
    "index.html": FIXTURE_PAGE,
    "docs.html": FIXTURE_PAGE.replace("<title>Fixture</title>", "<title>Docs</title>").replace(/<picture>.*<\/picture>\n/, '<img src="diagram.svg" alt="">\n'),
    "site.css": "body{background:url(bg.webp)}\n/* .old{background:url(old.webp)} */\n",
    "thumbhash.js": "// the placeholders\n",
    "favicon.svg": "",
    "og.png": "",
    "hero.jpg": "",
    "snap.webp": "",
    "snap-still.webp": "",
    "photo.jpg": "",
    "photo-2x.jpg": "",
    "bg.webp": "",
    "diagram.svg": "",
    "design/notes.md": "",
    "preview/home/index.html": '<!doctype html><title>Home</title><img src="media/patch.webp" alt="">\n',
    "preview/home/media/patch.webp": "",
    "preview/home/fonts/OFL.txt": "",
    [DIVE_PAGE]: DIVE_HTML,
    "preview/dive/assets/index-Aa1.js": DIVE_INDEX,
    "preview/dive/assets/world-Bb2.js": DIVE_WORLD,
    "preview/dive/assets/index-Cc3.css": "@font-face{src:url(font-Dd4.woff2)}.z0{background:url(../media/z0-1600.webp)}\n",
    "preview/dive/assets/font-Dd4.woff2": "",
    "preview/dive/media/z0-1600.avif": "",
    "preview/dive/media/z0-1600.webp": "",
    "preview/dive/media/z0u-2400.avif": "",
    "preview/dive/media/z0u-2400.webp": "",
    "preview/dive/media/print.avif": "",
    "preview/dive/media/print.webp": "",
    "preview/dive/media/snap-3d.txt": "",
    "preview/dive/media/snap-m01.mp4": "",
    "preview/dive/media/snap-m02.mp4": "",
    "preview/dive/media/z0-loop.av1.mp4": "",
    "preview/dive/media/z0-loop.mp4": "",
    "preview/dive/media/t2/d-pack0.avif": "",
  };
}

// Replaces from with to in files[name], and fails when from is absent,
// so an edit cannot silently stop applying.
function edit(files, name, from, to) {
  if (!files[name].includes(from)) throw new Error(`self-test fixture: ${name} has no ${JSON.stringify(from)}`);
  files[name] = files[name].replace(from, to);
}

// [name, edit, expected problem (null: none)]
const SELF_TESTS = [
  ["the fixture site", () => {}, null],
  ["a dive file nothing names", (f) => {
    f["preview/dive/media/clip.mp4"] = "";
  }, "preview/dive/media/clip.mp4 (0 B) is published, but neither preview/dive/index.html nor its stylesheets or scripts use it"],
  ["a sprite whose name is only an identifier key of the manifest", (f) => {
    f["preview/dive/media/seagrass.webp"] = "";
  }, "preview/dive/media/seagrass.webp (0 B) is published, but neither"],
  ["a sprite whose name is only a string key of the manifest", (f) => {
    f["preview/dive/media/rope-buoy.avif"] = "";
  }, "preview/dive/media/rope-buoy.avif (0 B) is published, but neither"],
  ["a bundle of an earlier build", (f) => {
    f["preview/dive/assets/index-Old9.js"] = "export const old=1;\n";
  }, "preview/dive/assets/index-Old9.js (0 B) is published, but neither"],
  ["a picture in a width that no script names", (f) => {
    f["preview/dive/media/z0u-1234.webp"] = "";
  }, "preview/dive/media/z0u-1234.webp (0 B) is published, but neither"],
  ["a file only a template without a fixed name could build", (f) => {
    f["preview/dive/media/kelp.webp"] = "";
  }, "preview/dive/media/kelp.webp (0 B) is published, but neither"],
  ["a name only in a comment of a script", (f) => {
    edit(f, "preview/dive/assets/index-Aa1.js", "/*! a bundle */", "/*! a bundle, once with \"old.webp\" */\n// and `old`");
    f["preview/dive/media/old.webp"] = "";
  }, "preview/dive/media/old.webp (0 B) is published, but neither"],
  ["a name only in a regular expression", (f) => {
    edit(f, "preview/dive/assets/world-Bb2.js", "var q=", "var o=/old\\.webp|\"old\"/i,q=");
    f["preview/dive/media/old.webp"] = "";
  }, "preview/dive/media/old.webp (0 B) is published, but neither"],
  ["quotes inside a regular expression", (f) => {
    edit(f, "preview/dive/assets/world-Bb2.js", "var q=", "var o=x=>/\"gone\\.mp4\"/.test(x),q=");
  }, null],
  ["a division that is not a regular expression", (f) => {
    edit(f, "preview/dive/assets/world-Bb2.js", "var q=", "var w=innerWidth/2;f(\"beam\");var h=innerHeight/2,q=");
    f["preview/dive/media/beam.webp"] = "";
  }, null],
  ["the page's own script names a picture", (f) => {
    edit(f, DIVE_PAGE, "d.classList.replace('no-js', 'js');", "d.classList.replace('no-js', 'js'); new Image().src = 'media/dawn.webp';");
    f["preview/dive/media/dawn.webp"] = "";
  }, null],
  ["a script that names a bundle that is not published", (f) => {
    edit(f, "preview/dive/assets/index-Aa1.js", "import(`./world-Bb2.js`)", "import(`./world-Zz0.js`)");
  }, "preview/dive/assets/index-Aa1.js:6 names ./world-Zz0.js, but no published file has that name in preview/dive/assets/"],
  ["a script that names media that is not published", (f) => {
    delete f["preview/dive/media/snap-3d.txt"];
  }, "names snap-3d.txt, but no published file has that name in preview/dive/assets/, preview/dive/, preview/dive/media/"],
  ["a script the tokenizer cannot read", (f) => {
    edit(f, "preview/dive/assets/world-Bb2.js", "var q=", "var u=\"unclosed\nvar q=");
  }, "preview/dive/assets/world-Bb2.js:1 could not be read as a script (a string that does not end at line 7)"],
  ["a file the dive's build reads, published", (f) => {
    f["preview/dive/media/manifest.json"] = "{}";
  }, "preview/dive/media/manifest.json (0 B) is published, but neither"],
  ["a file the dive's build reads, left out by _config.yml", (f) => {
    f["preview/dive/media/manifest.json"] = "{}";
    edit(f, "_config.yml", "  - design\n", "  - design\n  - preview/dive/media/manifest.json\n");
  }, null],
  ["an image no page references", (f) => {
    f["unused.png"] = "";
  }, "unused.png (0 B) is published but no page references it"],
  ["a page that references a file that is not published", (f) => {
    edit(f, "docs.html", "</body>", '<img src="missing.webp" alt="">\n</body>');
  }, "docs.html:17 references missing.webp, which is not a published file"],
  ["a dive page that references a file that is not published", (f) => {
    delete f["preview/dive/media/z0-1600.avif"];
  }, "preview/dive/index.html:13 references preview/dive/media/z0-1600.avif, which is not a published file (media/z0-1600.avif)"],
  ["a preview the site does not serve", (f) => {
    f["preview/old/index.html"] = "<!doctype html><title>Old</title>\n";
  }, "preview/old/index.html is published, but the site serves no preview besides preview/dive/ and preview/home/"],
  ["a notes file Pages publishes", (f) => {
    f["preview/dive/NOTES.md"] = "";
  }, "preview/dive/NOTES.md is a notes file that Pages publishes"],
];

export function selfTest() {
  const failures = [];
  for (const [name, change, expected] of SELF_TESTS) {
    const files = fixtureSite();
    try {
      change(files);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
      continue;
    }
    const list = publishedFiles(Object.keys(files), files["_config.yml"]);
    const { problems } = findProblems(list, (f) => files[f]);
    if (expected === null && problems.length) failures.push(`${name}: expected no problem, got\n       ${problems.join("\n       ")}`);
    if (expected !== null && !problems.some((p) => p.includes(expected))) {
      failures.push(`${name}: expected a problem with "${expected}", got\n       ${problems.join("\n       ") || "none"}`);
    }
  }
  const passes = SELF_TESTS.filter((t) => t[2] === null).length;
  return { failures, total: SELF_TESTS.length, passes };
}

export function checkAssets(site) {
  const tests = selfTest();
  for (const f of tests.failures) console.error(`FAIL self-test ${f}`);
  if (!tests.failures.length) {
    console.log(`ok   ${tests.total} self-tests: ${tests.passes} fixture sites pass, and each of ${tests.total - tests.passes} broken ones fails`);
  }

  const tracked = execFileSync("git", ["-C", site, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const config = join(site, "_config.yml");
  const files = publishedFiles(tracked, existsSync(config) ? readFileSync(config, "utf8") : "");
  const r = findProblems(
    files,
    (f) => readFileSync(join(site, f), "utf8"),
    (f) => (existsSync(join(site, f)) ? statSync(join(site, f)).size : 0),
  );
  if (r.problems.length) {
    for (const p of r.problems) console.error(`FAIL ${p}`);
    console.error(
      `\n${r.unused} unreferenced image(s), ${r.idle} unused dive file(s), ${r.missing} missing file(s), ` +
        `${r.strays} stray preview file(s), ${r.notes} published notes file(s) in ${site}` +
        (r.unused ? "\nDelete an unused image (git history keeps it), or reference it from a page." : "") +
        (r.idle
          ? "\nDelete a file the dive does not use (git history keeps it); one only its build reads can stay in git, left out of the site by _config.yml."
          : "") +
        (r.strays || r.notes ? "\nDelete the file (git history keeps it), or move it under a folder that _config.yml excludes." : ""),
    );
    return false;
  }
  console.log(`ok   all ${r.images} published images outside ${DIVE} are referenced by ${r.pages.join(", ")}`);
  console.log(`ok   all ${r.dive} files of ${DIVE} besides its page are used by the page, its stylesheets or its ${r.scripts} scripts`);
  console.log(`ok   all ${r.local} local files the pages and the dive's scripts reference are published`);
  console.log(
    `ok   ${PREVIEWS.map((p) => `${p} (${r.count(p)} files)`).join(" and ")} are the only previews published, and no notes file is published`,
  );
  return tests.failures.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const site = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  if (!PAGES.every((p) => existsSync(join(site, p)))) {
    console.error("usage: node .github/site-checks/assets.mjs [site-checkout]");
    process.exit(2);
  }
  process.exit(checkAssets(site) ? 0 : 1);
}
