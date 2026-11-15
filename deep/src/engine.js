// The renderer and its passes.
//
// Once, at load: the detail texture (the fine relief of rock, sand and wood) and the
// shadow map (the sun's shadows over the sunlit part of the dive; nothing in it moves, so
// it never shimmers and costs nothing after).
// Every frame: the water texture (caustics and the surface's slope), the scene into a
// half-float target (so the sun can be brighter than white), the light in the water on
// half the pixels, its softening, the bloom chain, and the final grade.
// Nothing here allocates once it is running.
import {
  Color, DepthTexture, HalfFloatType, LessEqualCompare, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Matrix4, Mesh,
  NearestFilter, NoToneMapping, OrthographicCamera, PlaneGeometry, RedFormat, RepeatWrapping, Scene, ShaderMaterial, UnsignedByteType,
  UnsignedIntType, Vector2, Vector3, Vector4, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { SHADOW_BOX, SUN } from './layout.js';
import { BLOOM_DOWN, BLOOM_UP, DETAIL_TEX_FRAG, FINAL_FRAG, G, NOISE, QUAD_VERT, SHAFT_BLUR, SHAFT_FRAG, WATER, WATER_TEX_FRAG } from './shaders.js';

// The three detail levels. `scale` caps how many real pixels a CSS pixel may get; `amount`
// scales how much is planted and how many creatures swim; the rest are per-pass costs.
export const LEVELS = {
  low: { scale: 1, msaa: 0, steps: 10, bloom: 4, amount: 0.25, shadow: 1024, water: 256, aniso: 1, minScale: 0.5 },
  medium: { scale: 1.5, msaa: 2, steps: 18, bloom: 5, amount: 0.5, shadow: 2048, water: 512, aniso: 4, minScale: 0.5 },
  high: { scale: 2, msaa: 4, steps: 30, bloom: 6, amount: 1, shadow: 4096, water: 512, aniso: 8, minScale: 0.6 },
};

export class Engine {
  constructor(canvas, level) {
    this.level = level;
    this.q = LEVELS[level];
    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = LinearSRGBColorSpace;   // the final pass writes sRGB itself
    r.toneMapping = NoToneMapping;
    r.setClearColor(new Color(0, 0, 0), 1);
    r.info.autoReset = false;
    this.gl = r.getContext();
    this.scale = 1;            // the fraction of the level's full resolution in use now
    this.width = 1; this.height = 1;
    this.quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new Mesh(new PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene = new Scene();
    this.quadScene.add(this.quad);
    const pass = (frag, uniforms, defines = {}) => new ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
    const aniso = Math.min(this.q.aniso, r.capabilities.getMaxAnisotropy());

    // the detail texture: drawn here, once
    const detail = new WebGLRenderTarget(1024, 1024, { type: UnsignedByteType, depthBuffer: false, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, generateMipmaps: true, anisotropy: aniso });
    this.drawQuad(pass(NOISE + DETAIL_TEX_FRAG, {}), detail);
    G.tDetail.value = detail.texture;

    // the water texture: drawn every frame
    const W = this.q.water;
    this.water = new WebGLRenderTarget(W, W, { type: UnsignedByteType, depthBuffer: false, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, generateMipmaps: true, anisotropy: aniso });
    this.waterMat = pass(WATER_TEX_FRAG, { uTime: G.uTime });
    G.tWater.value = this.water.texture;

    // the shadow map: a box over the sunlit part of the dive, seen from the sun
    const S = this.q.shadow;
    this.shadow = new WebGLRenderTarget(S, S >> 1, { format: RedFormat, type: UnsignedByteType, depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter });
    this.shadow.depthTexture = new DepthTexture(S, S >> 1, UnsignedIntType);
    this.shadow.depthTexture.compareFunction = LessEqualCompare;
    this.shadow.depthTexture.minFilter = this.shadow.depthTexture.magFilter = LinearFilter;
    G.tShadow.value = this.shadow.depthTexture;
    this.shadowCam = shadowCamera();
    G.uShadowMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(this.shadowCam.projectionMatrix).multiply(this.shadowCam.matrixWorldInverse);

    this.invProj = new Matrix4();
    this.shaftMat = pass(WATER + SHAFT_FRAG, { ...G, tDepth: { value: null }, uInvProj: { value: this.invProj }, uCamWorld: { value: new Matrix4() }, uCamPos: { value: new Vector3() } }, { STEPS: this.q.steps });
    this.blurMat = pass(SHAFT_BLUR, { tSrc: { value: null }, uTexel: { value: new Vector2() } });
    this.downMat = pass(BLOOM_DOWN, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uFirst: { value: 0 } });
    this.upMat = pass(BLOOM_UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new Vector2() } });
    this.finalMat = pass(FINAL_FRAG, { tScene: { value: null }, tShaft: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: this.q.bloom }, uLook: { value: new Vector4(0, 0, 0, 0) }, uFade: { value: 1 } });
    this.targets = null;
    this.calls = 0; this.tris = 0;
  }

  // Size the targets for a canvas of w by h CSS pixels at the current scale.
  resize(w, h, dpr) {
    const ratio = Math.min(dpr, this.q.scale) * this.scale;
    const W = Math.max(2, Math.round(w * ratio)), H = Math.max(2, Math.round(h * ratio));
    if (this.targets && W === this.width && H === this.height) return;
    this.width = W; this.height = H;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    if (this.targets) for (const t of this.targets.all) t.dispose();
    const scene = new WebGLRenderTarget(W, H, { type: HalfFloatType, samples: this.q.msaa, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter });
    scene.depthTexture = new DepthTexture(W, H, UnsignedIntType);
    scene.depthTexture.minFilter = scene.depthTexture.magFilter = NearestFilter;
    const half = (k) => new WebGLRenderTarget(Math.max(2, W >> k), Math.max(2, H >> k), { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
    const shaft = half(1), shaft2 = half(1);
    const down = [], up = [];
    for (let i = 0; i < this.q.bloom; i++) { down.push(half(i + 1)); if (i < this.q.bloom - 1) up.push(half(i + 1)); }
    this.targets = { scene, shaft, shaft2, down, up, all: [scene, shaft, shaft2, ...down, ...up] };
    this.blurMat.uniforms.uTexel.value.set(1 / shaft.width, 1 / shaft.height);
  }

  drawQuad(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  // Draw the shadow map: everything that has a depth twin, as it stands at time zero.
  bakeShadow(scene) {
    const swapped = [], hidden = [];
    const t = G.uTime.value;
    G.uTime.value = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const d = o.material.userData.depth;
      if (d && o.userData.castShadow !== false) { swapped.push(o, o.material); o.material = d; o.userData.wasCulled = o.frustumCulled; }
      else if (o.visible) { hidden.push(o); o.visible = false; }
    });
    this.renderer.setRenderTarget(this.shadow);
    this.renderer.clear();
    this.renderer.render(scene, this.shadowCam);
    for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
    for (const o of hidden) o.visible = true;
    G.uTime.value = t;
  }

  // One frame.
  render(scene, camera, exposure, fade) {
    const r = this.renderer, t = this.targets;
    r.info.reset();
    this.drawQuad(this.waterMat, this.water);
    r.setRenderTarget(t.scene);
    r.render(scene, camera);
    this.calls = r.info.render.calls; this.tris = r.info.render.triangles;

    const s = this.shaftMat.uniforms;
    s.tDepth.value = t.scene.depthTexture;
    this.invProj.copy(camera.projectionMatrixInverse);
    s.uCamWorld.value.copy(camera.matrixWorld);
    s.uCamPos.value.copy(camera.position);
    this.drawQuad(this.shaftMat, t.shaft);
    this.blurMat.uniforms.tSrc.value = t.shaft.texture;
    this.drawQuad(this.blurMat, t.shaft2);

    // bloom: down the chain, then back up
    let src = t.scene;
    for (let i = 0; i < t.down.length; i++) {
      const d = this.downMat.uniforms;
      d.tSrc.value = src.texture; d.uTexel.value.set(0.5 / src.width, 0.5 / src.height); d.uFirst.value = i === 0 ? 1 : 0;
      this.drawQuad(this.downMat, t.down[i]);
      src = t.down[i];
    }
    for (let i = t.up.length - 1; i >= 0; i--) {
      const u = this.upMat.uniforms;
      u.tSrc.value = src.texture; u.tAdd.value = t.down[i].texture; u.uTexel.value.set(1 / src.width, 1 / src.height);
      this.drawQuad(this.upMat, t.up[i]);
      src = t.up[i];
    }

    const f = this.finalMat.uniforms;
    f.tScene.value = t.scene.texture; f.tShaft.value = t.shaft2.texture; f.tBloom.value = src.texture;
    f.uExposure.value = exposure; f.uFade.value = fade;
    this.drawQuad(this.finalMat, null);
  }
}

// A camera at the sun, looking down its ray, that just holds the box the shadows fall in.
function shadowCamera() {
  const [x0, x1, y0, y1, z0, z1] = SHADOW_BOX;
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
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

// Which level a device starts on: what it remembered, else what it says about itself.
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
