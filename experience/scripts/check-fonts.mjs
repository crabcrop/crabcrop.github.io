// The page's fonts are cut down to the characters the page uses (scripts/subset-fonts.py).
// This fails the build if the page or its scripts have gained a character that was not kept,
// which would otherwise show in a fallback font.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const kept = new Set(JSON.parse(readFileSync(join(root, 'src/fonts/chars.json'), 'utf8')).extra);
const files = [join(root, 'index.html'), join(root, 'src/styles.css')];
const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
walk(join(root, 'src'));
const missing = new Map();
for (const f of files) for (const ch of readFileSync(f, 'utf8')) if (ch.codePointAt(0) > 126 && !kept.has(ch)) missing.set(ch, f.slice(root.length));
if (missing.size) {
  console.error('These characters are not in the cut-down fonts: ' + [...missing].map(([ch, f]) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, ${f})`).join(', '));
  console.error('Run: python3 scripts/subset-fonts.py');
  process.exit(1);
}
