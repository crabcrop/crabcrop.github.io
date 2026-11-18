// The visitor's image: what the URL they built would serve. The source is a real photo from
// crabcrop.org's samples (photo.js: Snap at a skate park); the page puts it through the
// visitor's choices in the order the server works through a URL: the crop (a window around
// the subject, as smart crop finds it, or the whole picture fitted in), then the filters as
// written: the look, then the finish (crabcrop's own cut-out of the photo, on the brand
// backdrop with a soft shadow for the studio, or on nothing for removebg). It is drawn into a
// target whenever a choice changes; the formats card, the looks and the finale show it.
import { RenderTarget, UnsignedByteType, Vector2, Vector4 } from 'three/webgpu';
import { clamp, dot, exp, float, mix, pow, select, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { BRAND, PHOTO, maskTexture, photoTexture } from './photo.js';
import { pass } from './shaders.js';

// the crops, as the URL has them: crop:1200x630:smart, crop:760x760:smart, fit-in:1200x630
// (the whole photo, fitted inside 1200 by 630)
export const CROPS = [
  { name: 'Wide card', w: 1200, h: 630 },
  { name: 'Square', w: 760, h: 760 },
  { name: 'Whole picture', w: Math.round(630 * PHOTO.aspect), h: 630 },
];
for (const c of CROPS) c.aspect = c.w / c.h;
// studio(product), with its default pad of 10: the subject, cut out, takes the middle with a
// tenth of the picture clear on each side
const PAD = 0.1;

// The window of the photo a crop takes, as fractions of the photo from its top left
// [x, y, w, h] (it may run past the photo's edges for the studio, where the backdrop fills in)
export function windowFor(crop, finish) {
  const C = CROPS[crop], PW = PHOTO.w, PH = PHOTO.h, [bx0, by0, bx1, by1] = PHOTO.box;
  const cx = ((bx0 + bx1) / 2) * PW, cy = ((by0 + by1) / 2) * PH, bw = (bx1 - bx0) * PW, bh = (by1 - by0) * PH;
  let w, h, x, y;
  if (finish === 1) {
    w = Math.max(bw, bh * C.aspect) / (1 - 2 * PAD); h = w / C.aspect;
    x = cx - w / 2; y = cy - h / 2;
  } else if (crop === 2) {
    w = PW; h = PH; x = 0; y = 0;
  } else {
    // smart: the biggest window of the crop's shape, its middle on the subject's, kept inside
    w = Math.min(PW, PH * C.aspect); h = w / C.aspect;
    x = Math.min(Math.max(cx - w / 2, 0), PW - w); y = Math.min(Math.max(cy - h / 2, 0), PH - h);
  }
  return [x / PW, y / PH, w / PW, h / PH];
}

export function createPrint(engine) {
  const finish = uniform(0), look = uniform(0);
  // the window in the photo's texture (v up), the step to a neighbouring pixel, and the soft
  // shadow under the subject on the studio floor (its middle and size, in the picture's own uv)
  const win = uniform(new Vector4(0, 0, 1, 1)), texel = uniform(new Vector2(1 / PHOTO.w, 1 / PHOTO.h)), shadow = uniform(new Vector4(0.5, 0.1, 0.3, 0.05));
  const P = texture(photoTexture()), M = texture(maskTexture());
  const brand = vec3(...BRAND), duoDark = vec3(0x0d / 255, 0x20 / 255, 0x2e / 255), duoLight = vec3(0xff / 255, 0xd8 / 255, 0x8a / 255);
  const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
  const quad = pass(null);
  quad.fragmentNode = (() => {
    // (a full-screen pass writes the target top row first, so its v runs down the picture;
    // turned here so that everything below runs up it, as the photo's texture does)
    const q = vec2(uv().x, float(1).sub(uv().y));
    const p = win.xy.add(q.mul(win.zw)).toVar();
    // (the photo's own pixels, in the sRGB values filters work on)
    const at = (o) => pow(P.sample(clamp(p.add(o), 0.0, 1.0)).rgb, vec3(1 / 2.2));
    const c = at(vec2(0, 0)).toVar();
    // the look: sharpen(1.2):saturation(1.1); duotone(0d202e,ffd88a); sepia
    const blur = at(texel.mul(vec2(1, 0))).add(at(texel.mul(vec2(-1, 0)))).add(at(texel.mul(vec2(0, 1)))).add(at(texel.mul(vec2(0, -1)))).mul(0.25);
    const sharp = c.add(c.sub(blur).mul(1.2));
    const crisp = mix(vec3(luma(sharp)), sharp, 1.1);
    const deep = mix(duoDark, duoLight, smoothstep(0.03, 0.97, luma(c)));
    const sepia = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
    const g = clamp(select(look.lessThan(0.5), crisp, select(look.lessThan(1.5), deep, sepia)), 0.0, 1.0);
    // the finish: the subject is crabcrop's own mask of the photo (none past its edges)
    const inside = step(0.0, p.x).mul(step(p.x, 1.0)).mul(step(0.0, p.y)).mul(step(p.y, 1.0));
    const m = M.sample(clamp(p, 0.0, 1.0)).r.mul(inside);
    const d = q.sub(shadow.xy).div(shadow.zw), shade = exp(dot(d, d).negate()).mul(0.42);
    const backdrop = brand.mul(float(1).sub(shade));
    const studio = mix(backdrop, g, m);
    return select(finish.lessThan(0.5), vec4(g, 1.0), select(finish.lessThan(1.5), vec4(studio, 1.0), vec4(g, m)));
  })();

  let target = null, crop = 0;
  return {
    // draw the picture for these choices: { look, crop, finish } as indices. Returns the
    // target holding it (sRGB, 8 bits; alpha where it is cut out), and its size.
    draw(choices) {
      crop = choices.crop | 0;
      const C = CROPS[crop], f = choices.finish | 0;
      if (!target || target.width !== C.w || target.height !== C.h) {
        if (target) target.dispose();
        target = new RenderTarget(C.w, C.h, { type: UnsignedByteType, depthBuffer: false });
      }
      finish.value = f;
      look.value = choices.look | 0;
      const [x, y, w, h] = windowFor(crop, f);
      win.value.set(x, 1 - y - h, w, h);
      texel.value.set(Math.max(1, (w * PHOTO.w) / C.w) / PHOTO.w, Math.max(1, (h * PHOTO.h) / C.h) / PHOTO.h);
      // (the shadow: under the subject's feet, as wide as most of it)
      const [bx0, , bx1, by1] = PHOTO.box;
      shadow.value.set(((bx0 + bx1) / 2 - x) / w, 1 - (by1 - 0.035 - y) / h, ((bx1 - bx0) * 0.42) / w, 0.05 / h);
      engine.drawQuad(quad, target);
      return target;
    },
    // read the last picture back, for a canvas on the page (returns ImageData, top row first)
    async read() {
      if (!target) return null;
      const r = engine.renderer, w = target.width, h = target.height;
      const px = await r.readRenderTargetPixelsAsync(target, 0, 0, w, h);
      const img = new ImageData(w, h), row = w * 4, stride = px.length / h;
      for (let y = 0; y < h; y++) { const from = (engine.webgpu ? y : h - 1 - y) * stride; img.data.set(px.subarray(from, from + row), y * row); }
      return img;
    },
    get texture() { return target ? target.texture : null; },
    get aspect() { return CROPS[crop].aspect; },
  };
}
