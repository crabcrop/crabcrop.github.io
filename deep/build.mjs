// Bundle the dive into one self-contained HTML file.
//
//   node build.mjs              the page, minified, to out/index.html (not tracked)
//   node build.mjs --publish    the same, to ../under-the-sea/index.html: the page the site
//                               publishes at crabcrop.org/under-the-sea/ (its share card,
//                               card.jpg, sits beside it: dev/share-card.cjs draws it)
//   node build.mjs --readable   not minified (easier to debug)
//   node build.mjs --dev        out/dev.html: the page plus the tools in src/dev.js
//                               (fixed camera poses, the scripted descent, the benchmark)
//   node build.mjs --dev --entry=dev/x.js --out=/some/where/x.html --template=dev/bare.html
//                               a test page from another entry point, or in another page
//                               shell (dev/bare.html is the canvas alone), for working on
//                               one part by itself
//
// three.js and the dive's own code are bundled by esbuild and written into template.html
// in place of its <!--SCRIPT--> marker. Nothing else is loaded at run time: no texture,
// model, sound or font file exists. GLSL sits in the source as template strings tagged
// /* glsl */; their comments and spare whitespace are stripped here.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const readable = process.argv.includes('--readable');
const dev = process.argv.includes('--dev');
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const entry = arg('entry') ? resolve(arg('entry')) : join(here, 'src', 'main.js');
const publish = process.argv.includes('--publish') && !dev;
const outFile = arg('out') ? resolve(arg('out')) : publish ? join(here, '..', 'under-the-sea', 'index.html') : join(here, 'out', dev ? 'dev.html' : 'index.html');
const outDir = dirname(outFile);

// Shader text: drop comments and collapse whitespace, keeping the newline a # directive needs.
function squeeze(glsl) {
  return glsl
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // (only around marks that cannot join into another operator: `a - -b` must keep its space)
    .map((l) => (l[0] === '#' ? `\n${l}\n` : l.replace(/\s*([{}();,=<>?:])\s*/g, '$1')))
    .join(' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}
const glsl = {
  name: 'glsl',
  setup(b) {
    b.onLoad({ filter: /src[\\/].*\.js$/ }, (args) => {
      let code = readFileSync(args.path, 'utf8');
      if (!readable) code = code.replace(/\/\* glsl \*\/\s*`([^`]*)`/g, (m, body) => (body.includes('${') ? m : '`' + squeeze(body) + '`'));
      return { contents: code, loader: 'js' };
    });
  },
};

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: !readable,
  legalComments: 'eof',          // (three.js's licence notice stays in the page)
  write: false,
  define: { DEV: String(dev) },
  plugins: [glsl],
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// The page shell, with each zone's words from zones/<id>.html in place of its include marker,
// and every zone's styles (zones/*.css, core.css first) in place of /*ZONES*/ in its style.
let template = readFileSync(arg('template') ? resolve(arg('template')) : join(here, 'template.html'), 'utf8');
template = template.replace(/<!--include:([\w/.-]+)-->/g, (m, f) => readFileSync(join(here, f), 'utf8').trimEnd());
if (template.includes('/*ZONES*/')) {
  const css = readdirSync(join(here, 'zones')).filter((f) => f.endsWith('.css')).sort((a, b) => (a === 'core.css' ? -1 : b === 'core.css' ? 1 : a.localeCompare(b)));
  template = template.replace('/*ZONES*/', () => css.map((f) => readFileSync(join(here, 'zones', f), 'utf8').trim()).join('\n'));
}
if (!template.includes('<!--SCRIPT-->')) throw new Error('template.html has no <!--SCRIPT--> marker');
// The page's one script goes in by hash: a Content-Security-Policy, as the first tag after
// <meta charset>, that allows that script and nothing else to run, Snap's files to be
// fetched from the page's own folder, and no plugins, base changes or form posts.
const hash = createHash('sha256').update(js).digest('base64');
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
if (/http-equiv="Content-Security-Policy"/i.test(template)) throw new Error('template.html has its own CSP: the build writes it');
let html = template.replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
const charset = html.match(/<meta charset="utf-8">\n?/i);
if (!charset) throw new Error('template.html has no <meta charset="utf-8">');
html = html.replace(charset[0], (m) => `${m.trimEnd()}\n${csp}\n`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
// Snap's model and its texture, and the visitor's photo and its mask: the only files besides
// the page (media/), copied beside it.
let media = 0;
for (const f of readdirSync(join(here, 'media'))) {
  const from = join(here, 'media', f), to = join(outDir, f);
  let same = false;
  try { same = statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs; } catch (e) { /* not there yet */ }
  if (!same) copyFileSync(from, to);
  media += statSync(from).size;
}
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`${basename(outFile)}: ${kb(Buffer.byteLength(html))} (${kb(gzipSync(html).length)} gzipped), of which script ${kb(Buffer.byteLength(js))}; the files beside it (Snap, the photo): ${kb(media)} in all`);
