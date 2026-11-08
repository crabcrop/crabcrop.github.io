import * as THREE from 'three';
import { media, loadPicture } from '../media';
import type { Stage } from './stage';
import { clamp } from '../scroll';

const VERT = /* glsl */ `
attribute vec4 aRect;
attribute vec2 aFx;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 u = vec2(aFx.x > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
  vUv = aRect.xy + u * aRect.zw;
  vA = aFx.y;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec3 uGrade;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 c = texture2D(uMap, vUv);
  float a = c.a * vA * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c.rgb * uGrade, a);
}`;

export const FORMATS = ['avif', 'webp', 'jpeg', 'jxl', 'png', 'gif'] as const;
export type Fmt = (typeof FORMATS)[number];

interface Fish { ox: number; oy: number; ph: number; x: number; y: number; flip: number }
interface School { fmt: Fmt; home: [number, number]; ph: number; x: number; y: number; vx: number; fish: Fish[]; target: [number, number] | null }

/** Schools of crochet fish, one per image format, in the shallows. */
export class Schools {
  readonly mesh: THREE.InstancedMesh;
  private u: Record<string, THREE.IUniform>;
  private schools: School[] = [];
  private rect: THREE.InstancedBufferAttribute;
  private fx: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();
  private total = 0;
  /** A format the visitor is pointing at or has picked: its school gathers at the tag. */
  focus: Fmt | null = null;
  picked: Fmt | null = null;
  private raceAt = -1;

  constructor(stage: Stage, private phone: boolean) {
    const per = phone ? 3 : 4;
    const homes: Record<Fmt, [number, number]> = {
      avif: [0.68, 0.17], webp: [0.86, 0.22], jpeg: [0.93, 0.40], jxl: [0.76, 0.38], png: [0.63, 0.30], gif: [0.94, 0.11],
    };
    for (const [i, fmt] of FORMATS.entries()) {
      const n = fmt === 'gif' ? 2 : per;
      const fish: Fish[] = [];
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + i;
        fish.push({ ox: Math.cos(a) * (0.7 + 0.3 * Math.sin(j * 2.1)), oy: Math.sin(a) * 0.45, ph: j * 1.7 + i, x: 0, y: 0, flip: 1 });
      }
      this.schools.push({ fmt, home: homes[fmt], ph: i * 1.3, x: 0, y: 0, vx: 0, fish, target: null });
      this.total += n;
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 4), 4);
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 2), 2);
    geo.setAttribute('aRect', this.rect);
    geo.setAttribute('aFx', this.fx);
    this.u = { uMap: { value: null }, uOpacity: { value: 0 }, uGrade: { value: new THREE.Vector3(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.total);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  async load() {
    const img = await loadPicture('fish');
    const t = new THREE.Texture(img);
    t.needsUpdate = true;
    this.u.uMap.value = t;
    const W = media.fish.w, H = media.fish.h;
    let k = 0;
    for (const s of this.schools) {
      const [x, y, w, h] = media.fish.rects[s.fmt];
      for (let j = 0; j < s.fish.length; j++, k++) this.rect.setXYZW(k, x / W, 1 - (y + h) / H, w / W, h / H);
    }
    this.rect.needsUpdate = true;
  }

  /** Play the race once: AVIF, then JPEG XL, then WebP reach the tag. */
  race(t: number) { if (this.raceAt < 0) this.raceAt = t; }

  update(dt: number, t: number, o: { vis: number; w: number; h: number; tag: [number, number]; mouse: [number, number] | null; grade: [number, number, number] }) {
    this.mesh.visible = o.vis > 0.01 && !!this.u.uMap.value;
    if (!this.mesh.visible) return;
    this.u.uOpacity.value = o.vis;
    this.u.uGrade.value.set(...o.grade);
    const size = (this.phone ? 0.03 : 0.034) * o.h;
    const order: Fmt[] = ['avif', 'jxl', 'webp'];
    let k = 0;
    for (const s of this.schools) {
      // Where the school wants to be.
      let tx = (s.home[0] + Math.sin(t * 0.21 + s.ph) * 0.035) * o.w;
      let ty = (s.home[1] + Math.sin(t * 0.29 + s.ph * 1.7) * 0.03) * o.h;
      if (this.phone) { tx = (0.3 + (s.home[0] - 0.62) * 1.6) * o.w; ty = (0.12 + s.home[1] * 0.7) * o.h; }
      const gather = this.picked === s.fmt || this.focus === s.fmt;
      if (gather) { tx = o.tag[0] + size * 3.2; ty = o.tag[1] + size * 0.4; }
      if (this.raceAt >= 0 && !this.picked) {
        const i = order.indexOf(s.fmt);
        const rt = t - this.raceAt - i * 0.45;
        if (i >= 0 && rt > 0 && rt < 3.4) { tx = o.tag[0] + size * (3 + i * 2.6); ty = o.tag[1] + size * (0.4 + i * 1.3); }
        if (t - this.raceAt > 5) this.raceAt = -2; // done, never again
      }
      if (!s.x) { s.x = tx; s.y = ty; }
      const speed = gather || this.raceAt >= 0 ? 3.2 : 0.9;
      const nx = s.x + (tx - s.x) * clamp(dt * speed);
      s.vx = s.vx * 0.9 + (nx - s.x) * 0.1 / Math.max(dt, 1e-3);
      s.x = nx;
      s.y += (ty - s.y) * clamp(dt * speed);
      const spread = gather ? 1.4 : 1;
      for (const f of s.fish) {
        let fx = s.x + (f.ox * size * 2.6 + Math.sin(t * 1.1 + f.ph) * size * 0.5) * spread;
        let fy = s.y + (f.oy * size * 2.2 + Math.sin(t * 1.6 + f.ph * 1.3) * size * 0.3) * spread;
        if (o.mouse) {
          const dx = fx - o.mouse[0], dy = fy - o.mouse[1];
          const d = Math.hypot(dx, dy);
          if (d < size * 3.4) { const push = (size * 3.4 - d) * 0.8; fx += (dx / (d + 1e-3)) * push; fy += (dy / (d + 1e-3)) * push; }
        }
        if (!f.x && !f.y) { f.x = fx; f.y = fy; }
        f.x += (fx - f.x) * clamp(dt * 6);
        f.y += (fy - f.y) * clamp(dt * 6);
        if (Math.abs(s.vx) > 4) f.flip = s.vx > 0 ? 1 : -1;
        const [, , rw, rh] = media.fish.rects[s.fmt];
        const sh = s.fmt === 'gif' ? size * 1.5 : size;
        const d = this.dummy;
        d.position.set(f.x, -f.y, 0);
        d.rotation.set(0, 0, Math.sin(t * 2 + f.ph) * 0.06);
        d.scale.set(sh * (rw / rh), sh, 1);
        d.updateMatrix();
        this.mesh.setMatrixAt(k, d.matrix);
        this.fx.setXY(k, f.flip, 1);
        k++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fx.needsUpdate = true;
  }
}
