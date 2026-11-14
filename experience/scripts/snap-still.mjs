// The stills of Snap for the page without motion, where it cannot show him
// on the pier with his print: on his feet (the kelp forest, the cabin) and
// in the submarine (below the wreck). They are taken from the page's own
// world, so they match what the moving page shows. This runs the dev server
// and scrolls down the dive as a visitor would. In the shallows, where he
// stands on the sand, and again in the twilight zone, once he has got into
// the submarine by the wreck, it draws only him (and the submarine), in
// plain light, on a clear canvas, and saves that: .cache/snap-walk.png and
// .cache/snap-sub.png. Encode them with:
// python3 scripts/encode-media.py still
//
// usage: node scripts/snap-still.mjs   (needs Playwright with its Chromium)
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// (Playwright is not one of the page's dependencies: this finds it wherever it is installed, globally too)
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = fileURLToPath(new URL('../.cache', import.meta.url));
const server = await createServer({ root, logLevel: 'error', server: { port: 4199, strictPort: false } });
await server.listen();
const port = server.httpServer.address().port;
// (software GL, so it runs on a machine with no GPU as well)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** The canvas with only Snap (and, with it, the submarine) drawn, as a PNG data URL. */
const take = (page, withSub) => page.evaluate(async (withSub) => {
  const w = window.__world, s = w.stage;
  // Eyes open and on the camera, no reaction under way.
  w.mouse = withSub ? w.sub.at(0.82, 0.3) : null;
  w.snap.rider.blinkAt = 1e9;
  w.idleFor = -1e9;
  await new Promise((r) => setTimeout(r, 1200));
  const keep = new Set(withSub ? [w.sub.mesh] : []);
  w.snap.rider.snap3d.group.traverse((o) => keep.add(o));
  const hidden = [];
  s.scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.visible && !keep.has(o)) { o.visible = false; hidden.push(o); } });
  // Plain light: no grade or haze from the water on either of them.
  w.sub.grade(1, 1, 1); w.sub.haze(0); w.sub.sea(null, 0);
  w.snap.rider.snap3d.u.uGrade.value.set(1, 1, 1);
  s.render();
  const url = s.renderer.domElement.toDataURL('image/png');
  for (const o of hidden) o.visible = true;
  return url;
}, withSub);

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__world?.snap.use3d, null, { timeout: 120000 });
  mkdirSync(cache, { recursive: true });
  const save = (name, png) => { writeFileSync(`${cache}/${name}`, Buffer.from(png.split(',')[1], 'base64')); console.log('wrote', `${cache}/${name}`); };
  // In steps, as a visitor would scroll, so every beat plays: the chain, the walk, the leap into his seat.
  let y = 0;
  const down = async (id) => {
    const to = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + scrollY + innerHeight * 0.5, id);
    for (; y < to; y += 150) { await page.evaluate((at) => scrollTo(0, at), y); await page.waitForTimeout(60); }
    await page.evaluate((at) => scrollTo(0, at), to);
  };

  // The shallows: he is off the chain and stands on the sand.
  await down('s1');
  await page.waitForFunction(() => window.__world.snap.claw && window.__world.out.zone === 's1' && window.__world.out.s1On > 0.99, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  save('snap-walk.png', await take(page, false));

  // The twilight zone: he is in the submarine.
  await down('s5');
  await page.waitForFunction(() => window.__world.sub.ready && window.__world.snap.aboard && window.__world.out.zone === 's5', null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  save('snap-sub.png', await take(page, true));
} finally {
  await browser.close();
  await server.close();
}
