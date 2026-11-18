// The visitor's picture: a real photo from crabcrop.org's own samples (ai-skate-before.jpg on
// the site: Snap at a skate park, holding up his little felt print), and the subject's mask,
// which is crabcrop's own background removal of it (the alpha of ai-skate-removebg.webp on the
// site). Both are fetched from beside the page (photo.avif, or photo.webp where AVIF will not
// decode, and photo-mask.webp). The page crops, grades and finishes the photo for the
// visitor's choices (print.js), and it is the print Snap carries in the scene (cast.js,
// main.js) and the one the climb shows taking on each choice (zones/s7.js). Until it loads,
// or where it cannot, the felt print (feltprint.js) stands in.
import { NoColorSpace, SRGBColorSpace, Texture } from 'three/webgpu';
import { float, mix, step, texture as sampler, uv, vec2, vec3 } from 'three/tsl';
import { feltPrint } from './feltprint.js';

// its size, and the subject: the mask's box (alpha over a half) and its middle, as fractions
// of the photo from its top left (measured once from the mask)
export const PHOTO = { w: 1000, h: 667, aspect: 1000 / 667, box: [0.053, 0.136, 0.62, 0.889], mid: [0.338, 0.538] };
// crabcrop's brand colour, the backdrop studio(…, bg:brand) puts behind the subject (as in
// the site's own render of this photo, studio-brand.webp)
export const BRAND = [14 / 255, 124 / 255, 121 / 255];

async function bitmap(names) {
  for (const n of names) {
    try {
      const r = await fetch(new URL(n, document.baseURI));
      if (!r.ok) continue;
      return { name: n, img: await createImageBitmap(await r.blob()) };
    } catch (e) { /* this format will not decode here: try the next */ }
  }
  return null;
}

// (each texture's picture is a canvas the photo's own size: the stand-in is drawn on it, and the
// photo over it when it comes, so the texture keeps its size, and a canvas is turned the right
// way up on either backend, as a bitmap is not)
const canvas = (fill) => {
  const c = document.createElement('canvas'); c.width = PHOTO.w; c.height = PHOTO.h;
  fill(c.getContext('2d'));
  return c;
};
const texture = (img, space) => { const t = new Texture(img); t.colorSpace = space; t.needsUpdate = true; return t; };
let photo = null, mask = null, loading = null, got = null;
const draw = (t, img) => { t.image.getContext('2d').drawImage(img, 0, 0, PHOTO.w, PHOTO.h); t.needsUpdate = true; };

// the photo as a texture (sRGB); the felt print until it has loaded
export function photoTexture() {
  if (!photo) {
    photo = texture(canvas((g) => { const f = feltPrint().image; g.fillStyle = '#f1e7d2'; g.fillRect(0, 0, PHOTO.w, PHOTO.h); g.drawImage(f, (PHOTO.w - (f.width * PHOTO.h) / f.height) / 2, 0, (f.width * PHOTO.h) / f.height, PHOTO.h); }), SRGBColorSpace);
    load();
  }
  return photo;
}
// the subject's mask (0 the background, 1 the subject; linear); all subject until it has loaded
export function maskTexture() {
  if (!mask) { mask = texture(canvas((g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, PHOTO.w, PHOTO.h); }), NoColorSpace); load(); }
  return mask;
}
// resolves when both have loaded (true) or could not (false)
export function photoReady() { return load(); }
// the photo's file, as loaded (for an <img>), or null
export const photoFile = () => (got && got.photo ? got.photo.name : null);

function load() {
  if (loading) return loading;
  loading = Promise.all([bitmap(['photo.avif', 'photo.webp']), bitmap(['photo-mask.webp'])]).then(([p, m]) => {
    got = { photo: p, mask: m };
    // (the textures the materials already sample take the pictures in place)
    if (p) draw(photoTexture(), p.img);
    if (m) draw(maskTexture(), m.img);
    return !!(p && m);
  }).catch(() => false);
  return loading;
}

// The cut-out for the page's own pictures (the climb's print, the finale as a page): the photo
// through crabcrop's mask, drawn once on a canvas, as a data URL; null where the photo did not
// load. Whole, as removebg leaves it (the frame kept, the background gone), or cut to the
// subject's box, which studio(…) then sets in the middle of its backdrop.
const cuts = [null, null];
export function cutoutURL(subject = false) {
  const k = subject ? 1 : 0;
  if (cuts[k]) return cuts[k];
  cuts[k] = load().then((ok) => {
    if (!ok) return null;
    const c = document.createElement('canvas'); c.width = PHOTO.w; c.height = PHOTO.h;
    const g = c.getContext('2d');
    // (the mask's grey into alpha, then the photo drawn only where it is)
    g.drawImage(got.mask.img, 0, 0, PHOTO.w, PHOTO.h);
    const d = g.getImageData(0, 0, PHOTO.w, PHOTO.h), px = d.data;
    for (let i = 0; i < px.length; i += 4) { px[i + 3] = px[i]; px[i] = px[i + 1] = px[i + 2] = 255; }
    g.putImageData(d, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.drawImage(got.photo.img, 0, 0, PHOTO.w, PHOTO.h);
    if (!subject) return c.toDataURL('image/webp', 0.86);
    const [x0, y0, x1, y1] = PHOTO.box, x = Math.floor(x0 * PHOTO.w), y = Math.floor(y0 * PHOTO.h), w = Math.ceil((x1 - x0) * PHOTO.w), h = Math.ceil((y1 - y0) * PHOTO.h);
    const b = document.createElement('canvas'); b.width = w; b.height = h;
    b.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
    return b.toDataURL('image/webp', 0.86);
  });
  return cuts[k];
}

// The photo as a print, for the scene (Snap's claw, the water, the geode, the pincer): inside a
// thin white border, the way a photo comes back from the printer. A colour node (sRGB decoded).
export function photoPrint() {
  const b = 0.035, q = uv(), r = vec2(b, b * PHOTO.aspect);
  const pic = sampler(photoTexture()).sample(q.sub(r).div(vec2(1, 1).sub(r.mul(2)))).rgb;
  const on = step(r.x, q.x).mul(step(q.x, float(1).sub(r.x))).mul(step(r.y, q.y)).mul(step(q.y, float(1).sub(r.y)));
  return mix(vec3(0.94, 0.93, 0.9), pic, on);
}
