// Bundle the dive into one self-contained HTML file.
//
//   node build.mjs              the page, minified, to out/index.html (not tracked)
//   node build.mjs --publish    the same, to ../preview/deep/index.html: the published preview
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const readable = process.argv.includes('--readable');
const dev = process.argv.includes('--dev');
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const entry = arg('entry') ? resolve(arg('entry')) : join(here, 'src', 'main.js');
const publish = process.argv.includes('--publish') && !dev;
const outFile = arg('out') ? resolve(arg('out')) : publish ? join(here, '..', 'preview', 'deep', 'index.html') : join(here, 'out', dev ? 'dev.html' : 'index.html');
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
  legalComments: 'none',
  write: false,
  define: { DEV: String(dev) },
  plugins: [glsl],
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(arg('template') ? resolve(arg('template')) : join(here, 'template.html'), 'utf8');
if (!template.includes('<!--SCRIPT-->')) throw new Error('template.html has no <!--SCRIPT--> marker');
const html = template.replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`${basename(outFile)}: ${kb(Buffer.byteLength(html))} (${kb(gzipSync(html).length)} gzipped), of which script ${kb(Buffer.byteLength(js))}`);
