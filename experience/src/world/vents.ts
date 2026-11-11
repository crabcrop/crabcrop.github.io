import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';
import { clamp } from '../scroll';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// The print lying in the geode, lit from inside the crystals.
const PRINT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uA, uTime;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.01) discard;
  float pulse = 0.92 + 0.08 * sin(uTime * 2.2);
  gl_FragColor = vec4(applyLook(c.rgb * vec3(1.08, 1.02, 0.95) * pulse), c.a * uA);
}`;

// The light the geode gives off round the print.
const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform float uA, uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  float a = exp(-r * 3.5) * (0.85 + 0.15 * sin(uTime * 2.2));
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.62), a * uA);
}`;

// Tube worms in the foreground. Retracted, the plumes at the top of the
// tubes sink and fade, as if pulled back inside.
const WORM_VERT = /* glsl */ `
uniform float uTime, uIn, uPhase;
varying vec2 vUv;
varying float vPlume;
void main() {
  vUv = uv;
  vec3 p = position;
  float top = smoothstep(0.55, 0.85, uv.y);           // the plumes' band
  vPlume = top;
  p.y -= top * uIn * 0.16;                              // pulled down into the tubes
  p.x += sin(uTime * 1.3 + uPhase + uv.y * 4.0) * 0.012 * uv.y * (1.0 - uIn);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const WORM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uA, uIn;
varying vec2 vUv;
varying float vPlume;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.01) discard;
  // in the vents' warm dark: dimmer, with orange light from below
  vec3 col = c.rgb * vec3(0.5, 0.42, 0.4) + vec3(0.1, 0.03, 0.0) * (1.0 - vUv.y);
  float hide = vPlume * uIn;
  gl_FragColor = vec4(applyLook(col), c.a * uA * (1.0 - hide));
}`;

interface Worms { m: THREE.Mesh; u: Record<string, THREE.IUniform>; in: number; v: number }

/**
 * The vents: Snap's print lying in the glowing geode until he takes it, and
 * tube worms in the foreground that pull their plumes in when the cursor
 * comes close, then slowly push them out again.
 */
export class Vents {
  private print: THREE.Mesh;
  private pu: Record<string, THREE.IUniform>;
  private glow: THREE.Mesh;
  private gu: Record<string, THREE.IUniform>;
  private worms: Worms[] = [];
  private ready = false;
  /** Where the print lies and how big, on screen, for the pickup. */
  readonly at = { x: 0, y: 0, h: 0 };

  constructor(stage: Stage, private phone: boolean) {
    this.pu = { uMap: { value: null }, uA: { value: 0 }, uTime: { value: 0 }, ...LOOK };
    this.print = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: PRINT_FRAG, uniforms: this.pu, transparent: true, depthTest: false, depthWrite: false }));
    this.print.renderOrder = 1;
    this.gu = { uA: { value: 0 }, uTime: { value: 0 } };
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: GLOW_FRAG, uniforms: this.gu, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.renderOrder = 0;
    for (const m of [this.print, this.glow]) { m.visible = false; m.frustumCulled = false; stage.scene.add(m); }
    const geo = new THREE.PlaneGeometry(1, 1, 1, 20);
    for (let i = 0; i < (phone ? 1 : 2); i++) {
      const u = { uMap: { value: null as THREE.Texture | null }, uA: { value: 0 }, uIn: { value: 0 }, uTime: { value: 0 }, uPhase: { value: i * 2.3 }, ...LOOK };
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: WORM_VERT, fragmentShader: WORM_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = 8;
      m.frustumCulled = false;
      m.visible = false;
      stage.scene.add(m);
      this.worms.push({ m, u, in: 0, v: 0 });
    }
  }

  async load() {
    const [print, worms] = await Promise.all([loadPicture('print'), loadPicture('worms')]);
    this.pu.uMap.value = imageTexture(print);
    const wt = imageTexture(worms);
    for (const w of this.worms) w.u.uMap.value = wt;
    this.ready = true;
  }

  /**
   * vis: the zone's visibility; geode: the middle of the geode on screen and
   * its height there, px; taken: Snap has the print now; mouse: the cursor;
   * startle: something big just happened (Snap landing), the worms duck.
   */
  update(dt: number, t: number, o: { vis: number; geode: [number, number, number]; taken: boolean; w: number; h: number; mouse: [number, number] | null; startle: boolean }) {
    const on = this.ready && o.vis > 0.01;
    this.print.visible = this.glow.visible = on && !o.taken;
    if (this.print.visible) {
      const [gx, gy, gh] = o.geode;
      const ph = gh * (this.phone ? 0.3 : 0.42), pw = ph * (media.print.w / media.print.h);
      this.print.position.set(gx, -(gy - gh * 0.05), 0);
      this.print.rotation.z = -0.12;
      this.print.scale.set(pw, ph, 1);
      this.pu.uA.value = o.vis;
      this.pu.uTime.value = t;
      this.glow.position.set(gx, -gy, 0);
      this.glow.scale.set(gh * (this.phone ? 1.6 : 2.2), gh * (this.phone ? 1.2 : 1.6), 1);
      this.gu.uA.value = o.vis * 0.55;
      this.gu.uTime.value = t;
      this.at.x = gx; this.at.y = gy - gh * 0.05; this.at.h = ph;
    }

    // The worms: one cluster in each bottom corner (one, bottom right, on phones).
    const wm = media.worms;
    const h = o.h * (this.phone ? 0.3 : 0.4), w = h * (wm.w / wm.h);
    const par = o.mouse ? (o.mouse[0] / o.w - 0.5) * -30 : 0;
    this.worms.forEach((wo, i) => {
      wo.m.visible = on;
      if (!on) return;
      const right = this.phone || i === 1;
      const x = (right ? o.w - w * 0.22 : w * 0.2) + par;
      const y = o.h - h * 0.3;
      wo.m.position.set(x, -y, 0);
      wo.m.scale.set(right ? -w : w, h, 1);
      // the plumes are near the top of the cluster: duck when the cursor (or a tap) comes near
      const plume: [number, number] = [x, y - h * 0.3];
      const near = o.mouse ? Math.hypot(o.mouse[0] - plume[0], o.mouse[1] - plume[1]) < h * 0.55 : false;
      const target = near || o.startle ? 1 : 0;
      // in fast, out slowly
      wo.in += (target - wo.in) * clamp(dt * (target > wo.in ? 9 : 0.9));
      wo.u.uIn.value = wo.in;
      wo.u.uA.value = o.vis;
      wo.u.uTime.value = t;
    });
  }
}
