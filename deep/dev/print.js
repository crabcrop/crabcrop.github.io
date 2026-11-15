// Dev entry: the dive with Snap, and the visitor's picture on demand:
// window.__print(look, crop, finish) resolves to a PNG data URL of the picture.
import { startDive } from '../src/app.js';
import { buildCast } from '../src/cast.js';
import { createPrint } from '../src/print.js';

let cast = null;
const keep = (ctx) => { cast = buildCast(ctx); return cast; };
startDive({ parts: [keep] }).then(({ engine }) => {
  const print = createPrint(engine, cast.snap);
  window.__print = async (look, crop, finish) => {
    print.draw({ look, crop, finish }, 20);
    const img = await print.read();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };
}).catch((e) => console.error('dive: ' + (e && e.stack || e)));
