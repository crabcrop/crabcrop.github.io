// The renderer and its passes, on three.js's WebGPU renderer. Where the browser has no
// WebGPU it runs the same passes through WebGL 2 by itself.
//
// Once, at load: the detail texture (the fine relief of rock, sand and wood) and the
// shadow map (the sun's shadows over the sunlit part of the dive; nothing in it moves, so
// it never shimmers and costs nothing after).
// Every frame: the water texture (caustics and the surface's slope), the scene into a
// half-float target (so the sun can be brighter than white; its alpha holds how far each
// pixel is), the light in the water on half the pixels, its softening, the bloom chain,
// and the final grade.
// Nothing here allocates once it is running.
import {
  DepthTexture, HalfFloatType, LessEqualCompare, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Matrix4, NoToneMapping,
  OrthographicCamera, QuadMesh, RedFormat, RenderTarget, RepeatWrapping, UnsignedByteType, UnsignedIntType, Vector2, Vector3, Vector4,
  WebGLCoordinateSystem, WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, Loop, abs, clamp, cos, dot, exp, float, fract, int, ivec3, length, max, min, mix, normalize, pow, screenCoordinate, select, sin, smoothstep, sqrt,
  texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { SHADOW_BOX, SUN } from './layout.js';
import { G, KD, SIG, optDepth, pass, shadow1, sunFoot, vnoiseP, hash3 } from './shaders.js';

// The three detail levels. `scale` caps how many real pixels a CSS pixel may get; `amount`
// scales how much is planted and how many creatures swim; the rest are per-pass costs.
export const LEVELS = {
  low: { scale: 1, msaa: 0, steps: 10, bloom: 4, amount: 0.25, shadow: 1024, water: 256, minScale: 0.5 },
  medium: { scale: 1.5, msaa: 4, steps: 18, bloom: 5, amount: 0.5, shadow: 2048, water: 512, minScale: 0.5 },
  high: { scale: 2, msaa: 4, steps: 30, bloom: 6, amount: 1, shadow: 4096, water: 512, minScale: 0.6 },
};

export class Engine {
  constructor(canvas, level, forceWebGL = false, opts = {}) {
    this.level = level;
    this.q = LEVELS[level];
    this.renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', forceWebGL, trackTimestamp: !!opts.timestamps });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;   // the final pass writes sRGB itself
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = false;
    this.scale = 1;            // the fraction of the level's full resolution in use now
    this.width = 1; this.height = 1;
    this.targets = null;
    this.capture = null;       // dev only: when set, the last pass draws here instead of the screen
    this.lookAt = -1e9; this.lookK = 0;   // the chosen look washes over the scene for a moment
    this.calls = 0; this.tris = 0;
  }

  async init() {
    const r = this.renderer;
    await r.init();
    this.webgpu = !!r.backend.isWebGPUBackend;
    this.quad = new QuadMesh();

    // the detail texture: drawn here, once
    const detail = new RenderTarget(1024, 1024, { type: UnsignedByteType, depthBuffer: false, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, generateMipmaps: true, anisotropy: 8 });
    this.drawQuad(pass(detailTexture()), detail);
    G.detailTex = detail.texture;
    // the stitch texture: drawn here, once
    const stitch = new RenderTarget(512, 512, { type: UnsignedByteType, depthBuffer: false, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, generateMipmaps: true, anisotropy: 8 });
    this.drawQuad(pass(stitchTexture()), stitch);
    G.stitchTex = stitch.texture;

    // the water texture: drawn every frame
    const W = this.q.water;
    this.water = new RenderTarget(W, W, { type: UnsignedByteType, depthBuffer: false, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, generateMipmaps: true, anisotropy: 4 });
    this.waterMat = pass(waterTexture());
    G.waterTex = this.water.texture;

    // the shadow map: a box over the sunlit part of the dive, seen from the sun
    const S = this.q.shadow;
    this.shadow = new RenderTarget(S, S >> 1, { format: RedFormat, type: UnsignedByteType, depthBuffer: true });
    this.shadow.depthTexture = new DepthTexture(S, S >> 1, UnsignedIntType);
    this.shadow.depthTexture.compareFunction = LessEqualCompare;
    this.shadow.depthTexture.minFilter = this.shadow.depthTexture.magFilter = LinearFilter;
    G.shadowTex = this.shadow.depthTexture;
    G.shadowTexel.value.set(1 / S, 2 / S);
    this.shadowCam = shadowCamera(r.coordinateSystem);
    // from the sun's clip space to the map: y runs down the texture, and WebGL keeps depth in -1..1
    const zs = r.coordinateSystem === WebGLCoordinateSystem ? 0.5 : 1, zo = r.coordinateSystem === WebGLCoordinateSystem ? 0.5 : 0;
    G.shadowMat.value.set(0.5, 0, 0, 0.5, 0, -0.5, 0, 0.5, 0, 0, zs, zo, 0, 0, 0, 1).multiply(this.shadowCam.projectionMatrix).multiply(this.shadowCam.matrixWorldInverse);

    // the passes after the scene; each texture slot is its own binding, filled in every frame
    const slot = () => { const t = texture(this.water.texture); t.mergeable = false; return t; };
    this.u = {
      scene: slot(), blurSrc: slot(), add: slot(), src: slot(), fScene: slot(), fShaft: slot(), fBloom: slot(),
      invProj: uniform(new Matrix4()), camWorld: uniform(new Matrix4()), camPos: uniform(new Vector3()),
      texel: uniform(new Vector2()), first: uniform(0), size: uniform(new Vector2(1, 1)),
      exposure: uniform(1), bloom: uniform(this.q.bloom), look: uniform(new Vector4(0, 0, 0, 0)), fade: uniform(1),
      ascent: uniform(new Vector2(0, 0)),
    };
    this.shaftMat = pass(shaftPass(this.u, this.q.steps));
    this.blurMat = pass(blurPass(this.u));
    this.downMat = pass(bloomDown(this.u));
    this.upMat = pass(bloomUp(this.u));
    this.finalMat = pass(finalPass(this.u));
    return this;
  }

  // Size the targets for a canvas of w by h CSS pixels at the current scale.
  resize(w, h, dpr) {
    const ratio = Math.min(dpr, this.q.scale) * this.scale;
    const W = Math.max(2, Math.round(w * ratio)), H = Math.max(2, Math.round(h * ratio));
    if (this.targets && W === this.width && H === this.height) return;
    this.width = W; this.height = H;
    this.u.size.value.set(W, H);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    if (this.targets) for (const t of this.targets.all) t.dispose();
    const scene = new RenderTarget(W, H, { type: HalfFloatType, samples: this.q.msaa, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter });
    const half = (k) => new RenderTarget(Math.max(2, W >> k), Math.max(2, H >> k), { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
    const shaft = half(1), shaft2 = half(1);
    const down = [], up = [];
    for (let i = 0; i < this.q.bloom; i++) { down.push(half(i + 1)); if (i < this.q.bloom - 1) up.push(half(i + 1)); }
    this.targets = { scene, shaft, shaft2, down, up, all: [scene, shaft, shaft2, ...down, ...up] };
  }

  // Wash the scene in a look for a moment: 1 crisp, 2 deep sea, 3 vintage.
  pulseLook(k) { this.lookK = k; this.lookAt = G.time.value; }
  // Hold a look on the whole picture (k as above, amount 0 to 1: 0 lets it go): the kelp forest
  // shows the picked look, and the one hovered while it is hovered. The stronger of this and a
  // wash wins.
  holdLook(k, amount) { this.holdK = k; this.holdA = amount; }
  // The climb home (amount 0 to 1, q how far up 0 to 1): bands of every zone's colour slide
  // down past the window and warm streaks fall, behind the submarine and Snap.
  ascent(amount, q) { this.u.ascent.value.set(amount, q); }

  drawQuad(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  // Draw the shadow map: everything that has a depth twin, as it stands at time zero.
  bakeShadow(scene) {
    const swapped = [], hidden = [];
    const t = G.time.value;
    G.time.value = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const d = o.material.userData.depth;
      if (d && o.userData.castShadow !== false) { swapped.push(o, o.material, o.visible); o.material = d; o.visible = true; }
      else if (o.visible) { hidden.push(o); o.visible = false; }
    });
    this.renderer.setRenderTarget(this.shadow);
    this.renderer.clear();
    this.renderer.render(scene, this.shadowCam);
    for (let i = 0; i < swapped.length; i += 3) { swapped[i].material = swapped[i + 1]; swapped[i].visible = swapped[i + 2]; }
    for (const o of hidden) o.visible = true;
    G.time.value = t;
  }

  // One frame.
  render(scene, camera, exposure, fade) {
    const r = this.renderer, t = this.targets, u = this.u;
    r.info.reset();
    this.drawQuad(this.waterMat, this.water);
    r.setRenderTarget(t.scene);
    r.render(scene, camera);
    this.calls = r.info.render.drawCalls ?? r.info.render.calls; this.tris = r.info.render.triangles;

    u.scene.value = t.scene.texture;
    u.invProj.value.copy(camera.projectionMatrixInverse);
    u.camWorld.value.copy(camera.matrixWorld);
    u.camPos.value.copy(camera.position);
    this.drawQuad(this.shaftMat, t.shaft);
    u.blurSrc.value = t.shaft.texture;
    u.texel.value.set(1 / t.shaft.width, 1 / t.shaft.height);
    this.drawQuad(this.blurMat, t.shaft2);

    // bloom: down the chain, then back up
    let src = t.scene;
    for (let i = 0; i < t.down.length; i++) {
      u.src.value = src.texture; u.texel.value.set(0.5 / src.width, 0.5 / src.height); u.first.value = i === 0 ? 1 : 0;
      this.drawQuad(this.downMat, t.down[i]);
      src = t.down[i];
    }
    for (let i = t.up.length - 1; i >= 0; i--) {
      u.src.value = src.texture; u.add.value = t.down[i].texture; u.texel.value.set(1 / src.width, 1 / src.height);
      this.drawQuad(this.upMat, t.up[i]);
      src = t.up[i];
    }

    u.fScene.value = t.scene.texture; u.fShaft.value = t.shaft2.texture; u.fBloom.value = src.texture;
    u.exposure.value = exposure; u.fade.value = fade;
    const since = G.time.value - this.lookAt, w = since >= 0 && since < 3 ? (since < 0.25 ? since / 0.25 : 1 - (since - 0.25) / 2.75) : 0;
    const wash = w * w * (3 - 2 * w);
    if ((this.holdA || 0) > wash) u.look.value.set(this.holdK, this.holdA, 0, 0); else u.look.value.set(this.lookK, wash, 0, 0);
    this.drawQuad(this.finalMat, this.capture);
  }
}

// A camera at the sun, looking down its ray, that just holds the box the shadows fall in.
function shadowCamera(system) {
  const [x0, x1, y0, y1, z0, z1] = SHADOW_BOX;
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.coordinateSystem = system;
  const centre = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  cam.position.copy(centre).addScaledVector(new Vector3(-SUN[0], -SUN[1], -SUN[2]), 220);
  cam.up.set(1, 0, 0);       // the valley runs along the map's long side
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  let lx = 1e9, hx = -1e9, ly = 1e9, hy = -1e9, lz = 1e9, hz = -1e9;
  const v = new Vector3();
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    v.set(x, y, z).applyMatrix4(inv);
    lx = Math.min(lx, v.x); hx = Math.max(hx, v.x); ly = Math.min(ly, v.y); hy = Math.max(hy, v.y); lz = Math.min(lz, v.z); hz = Math.max(hz, v.z);
  }
  cam.left = lx; cam.right = hx; cam.bottom = ly; cam.top = hy; cam.near = -hz - 2; cam.far = -lz + 2;
  cam.updateProjectionMatrix();
  return cam;
}

// ---- the textures the page draws itself ---------------------------------------------------

// The detail texture, drawn once: rock, sand and wood all take their fine relief from it.
// It tiles. rg: the slope of the height, b: the height, a: a slower mottle for colour.
function detailTexture() {
  // tileable noise over the square, summed over octaves
  const tf = (p, per, oct) => {
    let s = float(0), n = 0, a = 0.5, f = per;
    for (let i = 0; i < oct; i++) { s = s.add(vnoiseP(vec3(p.mul(f), i * 3.7 + 1.3), int(f)).mul(a)); n += a; f *= 2; a *= 0.5; }
    return s.div(n);
  };
  // the nearest of one random point per cell, repeating every `per` cells: distance and id
  const tcell = (x, per) => {
    const best = float(8).toVar(), id = float(0).toVar();
    const p = x.floor(), f = x.sub(p).toVar();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const q = vec2(p.x.add(i), p.y.add(j)).mod(per).add(per).mod(per);
      const cx = hash3(ivec3(vec3(q, 5.0))), cy = hash3(ivec3(vec3(q, 11.0)));
      const rr = vec2(i, j).add(vec2(cx, cy)).sub(f);
      const d = dot(rr, rr);
      const closer = d.lessThan(best);
      id.assign(select(closer, hash3(ivec3(vec3(q, 23.0))), id));
      best.assign(min(best, d));
    }
    return { d: sqrt(best), id };
  };
  const height = Fn(([p]) => {
    const w = p.add(vec2(tf(p, 3, 4), tf(p.add(0.5), 3, 4)).sub(0.5).mul(0.11)).toVar();
    const f = tf(w, 3, 8);
    const ridge = float(1).sub(abs(tf(w.add(1.7), 5, 6).mul(2).sub(1)));
    const crack = min(abs(tf(w.add(4.1), 4, 5).mul(2).sub(1)).mul(7), 1).mul(min(abs(tf(w.yx.add(2.3), 9, 4).mul(2).sub(1)).mul(9), 1));
    const c = tcell(w.mul(29), 29);
    const pit = float(1).sub(smoothstep(0.0, 0.34, c.d)).mul(c.id.greaterThan(0.62).select(1.0, 0.0));
    return f.mul(0.5).add(ridge.mul(ridge).mul(0.24)).add(crack.mul(0.26)).sub(pit.mul(0.07));
  }, { p: 'vec2', return: 'float' });
  return Fn(() => {
    const p = uv().toVar();
    const e = 1 / 1024;
    const h = height(p);
    const g = vec2(height(p.add(vec2(e, 0))).sub(height(p.sub(vec2(e, 0)))), height(p.add(vec2(0, e))).sub(height(p.sub(vec2(0, e))))).div(2 * e);
    return vec4(clamp(g.mul(0.02).add(0.5), 0.0, 1.0), h, tf(p.add(7.3), 4, 5));
  })();
}

// The stitch texture, drawn once: eight by eight crochet stitches, each a V of two rounded
// strands of yarn, twisted, meeting at the bottom, with gaps between. rg: the slope of the
// yarn's height, b: the height, a: which stitch it is (for a little colour difference).
function stitchTexture() {
  const N = 8;
  // the height of the yarn at a point of one stitch (q in 0..1, y up)
  const leg = (q, ax, ay, bx, by) => {
    const pa = q.sub(vec2(ax, ay)), ba = vec2(bx - ax, by - ay);
    const t = clamp(dot(pa, ba).div(dot(ba, ba)), 0.0, 1.0);
    const d = length(pa.sub(ba.mul(t)));
    const r = 0.2;
    const across = clamp(d.div(r), 0.0, 1.0);
    const round = sqrt(max(float(1).sub(across.mul(across)), 0.0));
    // the ply: two strands twisted round each other, seen as slanted ridges along the leg
    const L = Math.hypot(bx - ax, by - ay), side = vec2(-(by - ay) / L, (bx - ax) / L);
    const ply = sin(t.mul(9.0 * Math.PI).add(dot(pa, side).mul(26.0))).mul(0.12).add(0.88);
    return round.mul(ply);
  };
  const height = Fn(([q]) => {
    const c = fract(q);
    const a = leg(c, 0.07, 0.96, 0.47, 0.1), b = leg(c, 0.93, 0.96, 0.53, 0.1);
    // the chain that joins this row to the one above, peeking between the Vs
    const top = leg(c, 0.0, 0.99, 1.0, 0.99).mul(0.55);
    return max(max(a, b), top);
  }, { q: 'vec2', return: 'float' });
  return Fn(() => {
    const q = uv().mul(N).toVar();
    const e = N / 512;
    const h = height(q);
    const g = vec2(height(q.add(vec2(e, 0))).sub(height(q.sub(vec2(e, 0)))), height(q.add(vec2(0, e))).sub(height(q.sub(vec2(0, e))))).div(2 * e);
    const cell = q.floor();
    const id = hash3(ivec3(vec3(cell.mod(N), 7.0)));
    return vec4(clamp(g.mul(0.08).add(0.5), 0.0, 1.0), h, id);
  })();
}

// The water texture, drawn every frame: r is the brightness of the caustics, b and a the
// slope of the surface. The surface is a sum of ten waves whose crests fit the tile a
// whole number of times, so the texture repeats without a seam. Light through it gathers
// where it curves like a lens: the brightness on the sea floor is one over the determinant
// of how the surface bends the rays (I + s * Hessian), and bright lines form where that
// reaches zero.
function waterTexture() {
  const WAVES = [[1, 2, 1.0, 0.0], [-2, 1, 0.9, 1.7], [3, 1, 0.62, 3.4], [1, -4, 0.5, 5.1], [4, 3, 0.4, 0.8], [-3, 5, 0.3, 2.5], [6, -2, 0.26, 4.2], [5, 7, 0.17, 5.9], [-8, 3, 0.15, 1.3], [2, 11, 0.10, 3.0]];
  const TAU = Math.PI * 2;
  return Fn(() => {
    const u0 = uv();
    const p = u0.add(vec2(sin(u0.y.mul(2).add(G.time.mul(0.11)).mul(TAU)), cos(u0.x.mul(3).sub(G.time.mul(0.08)).mul(TAU))).mul(0.018)).toVar();
    const hxx = float(0).toVar(), hyy = float(0).toVar(), hxy = float(0).toVar(), slope = vec2(0).toVar();
    for (const [kx, ky, w, ph] of WAVES) {
      const sp = (0.42 + 0.30 * Math.sqrt(Math.hypot(kx, ky))) * (kx + ky > 0 ? 1 : -1);
      const th = p.x.mul(TAU * kx).add(p.y.mul(TAU * ky)).add(G.time.mul(sp)).add(ph).toVar();
      const s = sin(th);
      hxx.subAssign(s.mul(w * kx * kx)); hyy.subAssign(s.mul(w * ky * ky)); hxy.subAssign(s.mul(w * kx * ky));
      slope.addAssign(vec2(kx, ky).mul(cos(th).mul(w)));
    }
    const S = 0.036;
    const det = hxx.mul(S).add(1).mul(hyy.mul(S).add(1)).sub(hxy.mul(hxy).mul(S * S));
    const c = float(0.085).div(abs(det).add(0.085));
    return vec4(c, c, slope.mul(0.03).add(0.5));
  })();
}

// ---- the passes that turn the drawn scene into the picture -----------------------------

const ign = (p) => dot(p, vec2(0.06711056, 0.00583715)).fract().mul(52.9829189).fract();

// Light in the water itself, on half the pixels: the sun's shafts (where the shadow map
// lets them through, shaped by the same net as the caustics), the lamp's cone, and the
// haze around each glow. A few steps along each pixel's line of sight, as far as whatever
// was drawn there. rgb: the light, a: how far the scene is, for the pass that softens it.
function shaftPass(u, STEPS) {
  return Fn(() => {
    const q = uv();
    const far = u.scene.sample(q).a.toVar();
    const vp = u.invProj.mul(vec4(q.x.mul(2).sub(1), float(1).sub(q.y.mul(2)), 0.5, 1.0));
    const dir = normalize(u.camWorld.mul(vec4(normalize(vp.xyz.div(vp.w)), 0.0)).xyz).toVar();
    const dist = min(far, 110.0).toVar();
    // nothing above the surface
    dist.assign(select(dir.y.greaterThan(1e-4), min(dist, u.camPos.y.negate().div(max(dir.y, 1e-4))), dist));
    const jitter = ign(screenCoordinate.xy);
    const dt = dist.div(STEPS).toVar();
    const sun = vec3(0).toVar(), other = vec3(0).toVar();
    Loop(STEPS, ({ i }) => {
      const t = float(i).add(jitter).mul(dt);
      const w = u.camPos.add(dir.mul(t)).toVar();
      const T = exp(SIG.mul(t).negate()).toVar();
      const fp = sunFoot(w);
      const beam = smoothstep(0.26, 0.62, texture(G.waterTex, fp.div(31.0)).level(2.6).r.mul(2.4)).mul(smoothstep(0.12, 0.55, texture(G.waterTex, fp.yx.div(13.0).add(0.3)).level(2.0).r.mul(2.4)));
      sun.addAssign(T.mul(exp(KD.mul(optDepth(w.y).div(G.sunDir.y)).negate())).mul(shadow1(w).mul(beam.mul(7.5).add(0.007))));
      const toL0 = G.lampPos.sub(w);
      const dl = length(toL0);
      const toL = toL0.div(dl).toVar();
      const cone = smoothstep(G.lampCol.w, mix(G.lampCol.w, 1.0, 0.75), dot(toL.negate(), G.lampDir));
      // water scatters mostly forward: a beam seen from its side or coming toward the eye
      // glows, one going away is faint (Henyey-Greenstein, g = 0.6)
      const phase = float(0.64).div(pow(float(1.36).sub(dot(toL, dir).mul(1.2)), 1.5));
      const here = G.lampCol.rgb.mul(cone).mul(exp(SIG.mul(dl).negate())).div(dl.mul(dl).mul(0.012).add(1.0)).mul(phase).mul(0.02).toVar();
      for (let g = 0; g < 4; g++) {
        const gp = G.glowPos.element(g);
        const f = max(float(1.0).sub(length(gp.xyz.sub(w)).div(gp.w)), 0.0);
        here.addAssign(G.glowCol.element(g).rgb.mul(f.mul(f).mul(f)).mul(0.028));
      }
      other.addAssign(T.mul(here));
    });
    const mu = max(dot(dir, G.sunDir), 0.0);
    // (the shafts are the sun's own gold more than the water's colour)
    const c = sun.mul(dt).mul(SIG).mul(mix(G.scat.add(vec3(0.04, 0.07, 0.05)), vec3(0.95, 0.80, 0.50), 0.45)).mul(G.sunCol).mul(mu.mul(mu).mul(mu).mul(2.0).add(0.25)).mul(G.light.w).mul(1.6).add(other.mul(dt));
    return vec4(min(c, vec3(20.0)), far);
  })();
}
// Soften it: a three by three average that does not cross an edge in depth. (Each ray
// started at a different point along its length, in a pattern that such an average turns
// back into an even tone.)
function blurPass(u) {
  return Fn(() => {
    const q = uv();
    const c0 = u.blurSrc.sample(q).toVar();
    const sum = vec3(0).toVar(), ws = float(0).toVar();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = u.blurSrc.sample(q.add(u.texel.mul(vec2(i, j)))).toVar();
      const w = float(1).div(abs(c.a.sub(c0.a)).div(max(c0.a, 0.1)).add(0.03));
      sum.addAssign(c.rgb.mul(w)); ws.addAssign(w);
    }
    return vec4(sum.div(ws), c0.a);
  })();
}

// Bloom: halve and halve again, then add back up. Nothing is cut out first: what comes
// back is a wide soft veil over the whole picture, with the bright things widest.
function bloomDown(u) {
  return Fn(() => {
    const q = uv();
    const a = min(u.src.sample(q.add(u.texel.mul(vec2(-1, -1)))).rgb, vec3(24)).toVar();
    const b = min(u.src.sample(q.add(u.texel.mul(vec2(1, -1)))).rgb, vec3(24)).toVar();
    const c = min(u.src.sample(q.add(u.texel.mul(vec2(-1, 1)))).rgb, vec3(24)).toVar();
    const d = min(u.src.sample(q.add(u.texel.mul(vec2(1, 1)))).rgb, vec3(24)).toVar();
    // (the first step weighs each sample down by its own brightness, so one white pixel cannot flicker the veil)
    const wt = (x) => float(1).div(max(x.r, max(x.g, x.b)).mul(u.first).add(1));
    const wa = wt(a), wb = wt(b), wc = wt(c), wd = wt(d);
    return vec4(a.mul(wa).add(b.mul(wb)).add(c.mul(wc)).add(d.mul(wd)).div(wa.add(wb).add(wc).add(wd)), 1.0);
  })();
}
function bloomUp(u) {
  return Fn(() => {
    const q = uv();
    const s = u.src.sample(q.add(u.texel.mul(vec2(-0.75, -0.75)))).rgb.add(u.src.sample(q.add(u.texel.mul(vec2(0.75, -0.75)))).rgb)
      .add(u.src.sample(q.add(u.texel.mul(vec2(-0.75, 0.75)))).rgb).add(u.src.sample(q.add(u.texel.mul(vec2(0.75, 0.75)))).rgb);
    return vec4(s.mul(0.25).add(u.add.sample(q).rgb), 1.0);
  })();
}

// The last pass: the scene, the light in the water, the veil; exposure and the curve that
// brings bright light into range; a little shaping of contrast; the chosen look; a
// vignette; and a grain finer than one step of brightness, so the long dark gradients do
// not show bands.
function finalPass(u) {
  const curve = (x) => clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
  const lum = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
  return Fn(() => {
    const q = uv();
    const sc = u.fScene.sample(q).toVar();
    const c = sc.rgb.add(u.fShaft.sample(q).rgb).toVar();
    const bl = u.fBloom.sample(q).rgb.div(u.bloom).toVar();
    c.assign(mix(c, bl, 0.07).add(bl.mul(0.035)).mul(u.exposure));
    // at the waterline, the meniscus where the surface meets the lens: a thin dark edge that
    // wobbles with the swell, a bright lip of light caught above it, and a little blur of
    // the picture right along it (only while the eye is within a hand's breadth of the surface)
    const near = float(1).sub(smoothstep(0.04, 0.3, abs(u.camPos.y))).toVar();
    const vp = u.invProj.mul(vec4(q.x.mul(2).sub(1), float(1).sub(q.y.mul(2)), 0.5, 1.0));
    const dir = normalize(u.camWorld.mul(vec4(normalize(vp.xyz.div(vp.w)), 0.0)).xyz);
    const px = float(1.1).div(u.size.y);                                         // about one pixel, as a slope
    const wob = sin(dir.x.mul(23.0).add(G.time.mul(1.7))).mul(1.8).add(sin(dir.x.mul(61.0).sub(G.time.mul(2.6))).mul(0.8)).mul(px);
    const e = dir.y.sub(wob).div(px).toVar();                                    // pixels above the edge
    const edge = exp(e.mul(e).mul(-0.35)).mul(near);
    const lip = exp(e.sub(2.6).mul(e.sub(2.6)).mul(-0.5)).mul(near);
    c.assign(c.mul(float(1).sub(edge.mul(0.55))).add(vec3(0.95, 0.92, 0.85).mul(lip).mul(0.35)));
    const d = q.sub(0.5);
    c.mulAssign(float(1).sub(dot(d, d).mul(0.75)));
    c.assign(curve(c));
    const l0 = lum(c).toVar();
    const l = mix(l0, l0.mul(l0).mul(float(3).sub(l0.mul(2))), 0.5).toVar();       // a gentle S on brightness
    c.mulAssign(l.div(max(l0, 1e-4)));
    c.assign(mix(c, vec3(l), smoothstep(0.6, 1.0, l).mul(0.1)));                   // the brightest lose a little colour
    c.assign(max(mix(vec3(l), c, 1.16), vec3(0.0)));                                // and the rest gain some: a diorama's colours
    // the looks of the second choice, on the whole picture: 1 crisp, 2 deep sea, 3 vintage
    const crisp = mix(vec3(l), c, 1.25).sub(0.5).mul(1.12).add(0.5);
    const deep = mix(vec3(0.051, 0.125, 0.180), vec3(1.0, 0.847, 0.541), smoothstep(0.02, 0.9, l));
    const sepia = mix(c, vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))), 0.86);
    const k = select(u.look.x.lessThan(1.5), crisp, select(u.look.x.lessThan(2.5), deep, sepia));
    c.assign(mix(c, clamp(k, 0.0, 1.0), u.look.y));
    // the climb home (the painted dive's "lines that show you are going up"): the view filled
    // with bands of every zone's colour, the shallower above, sliding down the window as the
    // visitor scrolls up through them (about 1.3 zones in view at once), and thin warm streaks
    // falling in narrow lanes, about three window heights a second; over what is more than a
    // few metres away (the scene's alpha is its distance), so the submarine, Snap and the print
    // stay in front
    const am = u.ascent.x;
    const yy = q.y;
    const pos = clamp(u.ascent.y.mul(8.4).add(float(1).sub(yy).mul(1.3)).sub(0.4), 0.0, 8.99).toVar();
    const bi = pos.floor(), bf = pos.sub(bi);
    // vents ember, black, deep navy, twilight violet, wreck teal, reef turquoise, kelp olive,
    // shallows aqua, sunset peach (picture values, in linear light)
    const ZC = [[0.36, 0.11, 0.04], [0.1, 0.11, 0.15], [0.07, 0.08, 0.22], [0.2, 0.1, 0.34], [0.05, 0.29, 0.35], [0.07, 0.58, 0.58], [0.3, 0.46, 0.2], [0.55, 0.88, 0.87], [1.0, 0.64, 0.5]]
      .map((v) => vec3(...v.map((x) => Math.pow(x, 2.2))));
    const zc = (i) => { let r = ZC[8]; for (let k = 7; k >= 0; k--) r = select(i.lessThan(k + 0.5), ZC[k], r); return r; };
    const band = mix(zc(bi), zc(bi.add(1)), smoothstep(0.25, 0.75, bf)).mul(float(1).sub(pow(abs(q.x.sub(0.5)).mul(2), 2.0).mul(0.35)));
    const behind = smoothstep(4.5, 8.0, sc.a);
    c.assign(mix(c, band, am.mul(behind).mul(0.92)));
    const lane = q.x.mul(u.size.x.div(5.0).max(160.0)).floor();
    const h = fract(sin(lane.mul(91.7)).mul(43758.5453));
    const st = fract(yy.mul(0.7).sub(h.mul(1.4).add(0.8).mul(G.time)).sub(h.mul(7.0)));
    const streak = select(h.greaterThanEqual(0.86), smoothstep(0.0, 0.08, st).mul(float(1).sub(smoothstep(0.08, 0.45, st))), float(0.0));
    c.addAssign(vec3(1.0, 0.94, 0.8).mul(streak.mul(am).mul(behind.mul(0.75).add(0.25)).mul(0.1)));
    c.assign(pow(max(c, vec3(0)), vec3(1 / 2.2)));
    c.addAssign(ign(screenCoordinate.xy).add(ign(screenCoordinate.xy.add(37.0))).sub(1.0).div(255.0));
    return vec4(c.mul(u.fade), 1.0);
  })();
}

// Which level a device starts on: what it was asked for, what it remembered, else what it
// says about itself.
export function pickLevel() {
  let saved = null;
  try { saved = localStorage.getItem('deep-level'); } catch (e) { /* storage may be shut */ }
  const asked = new URLSearchParams(location.search).get('level');
  if (asked && LEVELS[asked]) return asked;
  if (saved && LEVELS[saved]) return saved;
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (phone) return mem >= 8 ? 'medium' : 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}
