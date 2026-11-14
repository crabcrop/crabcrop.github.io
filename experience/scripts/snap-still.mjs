// The still of Snap in his submarine, for the page without motion: taken
// from the page's own world, so it matches what the moving page shows. Runs
// the dev server, lets Snap hop in and dive to the shallows, then draws only
// him and the submarine on a clear canvas and saves that as
// .cache/snap-sub.png. Encode it with: python3 scripts/encode-media.py still
//
// usage: node scripts/snap-still.mjs   (needs Playwright with its Chromium)
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// (Playwright is not one of the page's dependencies: this finds it wherever it is installed, globally too)
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../.cache/snap-sub.png', import.meta.url));
const server = await createServer({ root, logLevel: 'error', server: { port: 4199, strictPort: false } });
await server.listen();
const port = server.httpServer.address().port;
// (software GL, so it runs on a machine with no GPU as well)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__world?.sub.ready && window.__world.snap.use3d, null, { timeout: 120000 });
  // Down to the shallows in steps, as a visitor would scroll, so the story beat plays and he is in his seat.
  const top = await page.evaluate(() => document.getElementById('s1').getBoundingClientRect().top + scrollY + innerHeight * 0.5);
  for (let y = 0; y < top; y += 150) { await page.evaluate((to) => scrollTo(0, to), y); await page.waitForTimeout(60); }
  await page.evaluate((to) => scrollTo(0, to), top);
  await page.waitForFunction(() => window.__world.snap.riding && window.__world.out.zone === 's1' && window.__world.out.s1On > 0.99, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const png = await page.evaluate(async () => {
    const w = window.__world, s = w.stage;
    // Eyes open and on the camera, no reaction under way.
    const at = w.sub.at(...[0.82, 0.3]);
    w.mouse = [at[0], at[1]];
    w.snap.rider.blinkAt = 1e9;
    w.idleFor = -1e9;
    await new Promise((r) => setTimeout(r, 1200));
    const keep = new Set([w.sub.mesh]);
    w.snap.rider.snap3d.group.traverse((o) => keep.add(o));
    const hidden = [];
    s.scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.visible && !keep.has(o)) { o.visible = false; hidden.push(o); } });
    s.render();
    const url = s.renderer.domElement.toDataURL('image/png');
    for (const o of hidden) o.visible = true;
    return url;
  });
  mkdirSync(fileURLToPath(new URL('../.cache', import.meta.url)), { recursive: true });
  writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote', out);
} finally {
  await browser.close();
  await server.close();
}
