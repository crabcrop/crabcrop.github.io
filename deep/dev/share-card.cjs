// The share card of crabcrop.org/under-the-sea/ (../under-the-sea/card.jpg): still frames of the
// dive from the dev build, 1200 x 630 drawn at twice the size, with the words and the bar hidden.
//
//   node build.mjs --dev && node dev/share-card.cjs /some/where/card 3.14,6,0
//
// writes /some/where/card-3.14-6-0.png for each p,yaw,pitch given (yaw and pitch in degrees, added
// to where the path looks); the card is the reef at 3.14, turned 6 degrees, scaled to 1200 x 630
// and saved as a JPEG (quality 84). Playwright and its Chromium draw it; in software (no GPU) a
// frame takes a minute or two.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'out');
const [out, ...shots] = process.argv.slice(2);
(async () => {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.bin': 'application/octet-stream', '.avif': 'image/avif', '.webp': 'image/webp' };
  const server = http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent(req.url.split('?')[0])) || 'dev.html';
    const f = path.join(DIR, name.endsWith('.html') || !path.extname(name) ? 'dev.html' : name);
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await pg.goto(`http://127.0.0.1:${server.address().port}/dev.html?still&capture&webgl&level=high`);
  await pg.waitForFunction(() => window.__deep && window.__deep.ready, null, { timeout: 300000 });
  await pg.addStyleTag({ content: '.bar,main,.gauge,#fx,.dock,.note,.stats,.settings,.skip,.polaroid,.flash,.dawn,.ascent-print{display:none!important}' });
  await pg.waitForTimeout(8000);   // (Snap's model and the photo arrive)
  for (const s of shots) {
    const [p, yaw = 0, pitch = 0] = s.split(',').map(Number);
    const r = await pg.evaluate(async ([p, yaw, pitch]) => { await window.__deep.shot(p, 20, yaw, pitch); await window.__deep.shot(p, 20.05, yaw, pitch); return window.__deep.shot(p, 20.1, yaw, pitch); }, [p, yaw, pitch]);
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${out}-${p}-${yaw}-${pitch}.png`, timeout: 300000 });
    console.log(s, JSON.stringify(r));
  }
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no errors');
  await b.close(); server.close();
})();
