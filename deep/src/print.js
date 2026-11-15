// The visitor's image: what the URL they built would serve. It is a photograph of Snap
// taken by the page itself: his own model, posed and lit for the picture, framed by the
// crop they chose, set against the finish they chose (the water he was found in, a studio
// backdrop with a soft shadow, or cut out), and graded with the look they chose. It is
// drawn into a target whenever a choice changes; the finale shows it, and so does the
// frame in the geode.
import { Mesh, PerspectiveCamera, PlaneGeometry, RenderTarget, Scene, UnsignedByteType, Vector4 } from 'three/webgpu';
import { abs, clamp, dot, float, floor, length, mix, mod, pow, select, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { G, pass } from './shaders.js';
import { CENTRE } from './snap.js';

// the crops: aspect, and how much of him the frame holds (the camera's distance)
export const CROPS = [
  { name: 'Wide card', aspect: 1200 / 630, dist: 2.0 },
  { name: 'Square', aspect: 1, dist: 1.55 },
  { name: 'Whole picture', aspect: 4 / 3, dist: 2.6 },
];
const W = 960;

// (the studio stands far outside the world, beyond the shadow map's reach)
const AT = [600, 0, 600];

export function createPrint(engine, snap) {
  const scene = new Scene();
  const studio = new Mesh();
  studio.position.set(...AT);
  scene.add(studio);
  const finish = uniform(0), look = uniform(0);
  // the backdrop: water and sand, a studio sweep in the brand's night teal, or the
  // checkerboard that means "nothing here"
  const back = new Mesh(new PlaneGeometry(8, 5), pass(null));
  back.material.depthTest = true; back.material.depthWrite = true;
  back.material.fragmentNode = (() => {
    const q = uv();
    // (colours as seen: the grade turns them back after)
    const glow = float(1).sub(length(q.sub(vec2(0.5, 0.62))).mul(0.7));
    const water = mix(vec3(0.10, 0.31, 0.38), vec3(0.34, 0.66, 0.70), smoothstep(0.2, 1.0, q.y)).mul(glow.mul(0.35).add(0.75));
    const sand = mix(vec3(0.66, 0.60, 0.48), vec3(0.50, 0.45, 0.36), smoothstep(0.0, 0.32, q.y));
    const outside = mix(sand, water, smoothstep(0.24, 0.40, q.y));
    const sweep = mix(vec3(0.20, 0.36, 0.42), vec3(0.42, 0.60, 0.65), smoothstep(0.0, 0.9, q.y)).mul(glow.mul(0.4).add(0.7));
    const cell = mod(floor(q.x.mul(48)).add(floor(q.y.mul(30))), 2.0);
    const checker = mix(vec3(0.78), vec3(0.6), cell);
    const c = select(finish.lessThan(0.5), outside, select(finish.lessThan(1.5), sweep, checker));
    return vec4(pow(c, vec3(2.2)), 1.0);
  })();
  back.position.set(0, 0.6, -1.4);
  studio.add(back);
  // a soft shadow under him on the studio floor (none in the water, none when cut out)
  const shade = new Mesh(new PlaneGeometry(1.4, 0.7).rotateX(-Math.PI / 2), pass(null));
  shade.material.transparent = true;
  shade.material.fragmentNode = (() => {
    const d = length(uv().sub(0.5).mul(vec2(1.0, 1.6)));
    const a = float(1).sub(smoothstep(0.05, 0.5, d)).mul(0.45).mul(select(abs(finish.sub(1.0)).lessThan(0.5), float(1), float(0)));
    return vec4(0.0, 0.02, 0.03, a);
  })();
  shade.position.set(0, -0.31, 0);
  studio.add(shade);

  const camera = new PerspectiveCamera(30, CROPS[0].aspect, 0.05, 20);
  let him = null, target = null, crop = 0;
  const grade = pass(null);
  const src = texture(engine.water.texture); src.mergeable = false;
  grade.fragmentNode = (() => {
    const x = src.sample(uv()).rgb.mul(1.1);
    const c = clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0).toVar();
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722)).toVar();
    const crisp = mix(vec3(l), c, 1.25).sub(0.5).mul(1.12).add(0.5);
    const deep = mix(vec3(0.051, 0.125, 0.180), vec3(1.0, 0.847, 0.541), smoothstep(0.02, 0.9, l));
    const sepia = mix(c, vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))), 0.86);
    const k = select(look.lessThan(0.5), crisp, select(look.lessThan(1.5), deep, sepia));
    return vec4(pow(clamp(k, 0.0, 1.0), vec3(1 / 2.2)), 1.0);
  })();
  const keep = { opt: new Vector4(), light: new Vector4(), lamp: new Vector4(), scat: null, amb: null };

  return {
    // draw the picture for these choices: { look, crop, finish } as indices. Returns the
    // target holding it (sRGB, 8 bits), and its size.
    draw(choices, t) {
      if (!snap.ready) return null;
      if (!him) { him = new Mesh(snap.mesh.geometry, snap.mesh.material); him.frustumCulled = false; studio.add(him); }
      crop = choices.crop | 0;
      const C = CROPS[crop];
      const w = W, h = Math.round(W / C.aspect);
      if (!target || target.width !== w || target.height !== h) {
        if (target) { target.raw.dispose(); target.out.dispose(); }
        target = { raw: new RenderTarget(w, h, { type: UnsignedByteType, samples: 4 }), out: new RenderTarget(w, h, { type: UnsignedByteType }) };
        target.width = w; target.height = h;
      }
      finish.value = choices.finish | 0;
      look.value = choices.look | 0;
      // him: facing the camera, a little turned, his middle at the origin; smiling and waving
      him.scale.setScalar(snap.height);
      him.position.copy(CENTRE).multiplyScalar(-snap.height);
      him.rotation.set(0, -0.35, 0);
      him.updateMatrixWorld(true);
      camera.aspect = C.aspect;
      studio.updateMatrixWorld(true);
      camera.position.set(AT[0] + 0.15, AT[1] + 0.12, AT[2] + C.dist);
      camera.lookAt(AT[0], AT[1], AT[2]);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      snap.life.hello = 1; snap.life.squint = 0.8;
      snap.target.copy(camera.position);
      snap.live(t, 0.5, him);
      // light it as a photograph in shallow water (no caustics in the studio or cut out)
      keep.opt.copy(G.opt.value); keep.light.copy(G.light.value); keep.lamp.copy(G.lampCol.value);
      G.opt.value.set(4, 1, 60, 3.2);
      G.light.value.set(1.15, 1.2, finish.value === 0 ? 0.8 : 0, 0);
      G.lampCol.value.set(0, 0, 0, 0.8);
      const r = engine.renderer;
      r.setRenderTarget(target.raw);
      r.render(scene, camera);
      G.opt.value.copy(keep.opt); G.light.value.copy(keep.light); G.lampCol.value.copy(keep.lamp);
      src.value = target.raw.texture;
      engine.drawQuad(grade, target.out);
      return target.out;
    },
    // read the last picture back, for a canvas on the page (returns ImageData, top row first)
    async read() {
      if (!target) return null;
      const r = engine.renderer, w = target.width, h = target.height;
      const px = await r.readRenderTargetPixelsAsync(target.out, 0, 0, w, h);
      const img = new ImageData(w, h), row = w * 4, stride = px.length / h;
      for (let y = 0; y < h; y++) { const from = (engine.webgpu ? y : h - 1 - y) * stride; img.data.set(px.subarray(from, from + row), y * row); }
      return img;
    },
    get texture() { return target ? target.out.texture : null; },
    get aspect() { return CROPS[crop].aspect; },
  };
}
