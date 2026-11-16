// Dev entry: the dive, and the visitor's picture on demand:
// window.__print(look, crop, finish) resolves to a PNG data URL of the picture.
import { startDive } from '../src/app.js';
import { createPrint } from '../src/print.js';

startDive({ parts: [] }).then(({ engine }) => {
  const print = createPrint(engine);
  window.__print = async (look, crop, finish) => {
    print.draw({ look, crop, finish });
    const img = await print.read();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };
}).catch((e) => console.error('dive: ' + (e && e.stack || e)));
