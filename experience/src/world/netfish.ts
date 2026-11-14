import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';
import { clamp } from '../scroll';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FISH_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec4 uRect;
uniform float uOpacity, uFlip;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec2 u = vec2(uFlip > 0.0 ? vUv.x : 1.0 - vUv.x, vUv.y);
  vec4 c = texture2D(uMap, uRect.xy + u * uRect.zw);
  if (c.a < 0.01) discard;
  gl_FragColor = vec4(applyLook(c.rgb), c.a * uOpacity);
}`;

// A four-point sparkle, for the claw snip.
const SPARK_FRAG = /* glsl */ `
precision highp float;
uniform float uA;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float rays = max(0.0, 1.0 - abs(p.x) * 7.0 - abs(p.y) * 0.9) + max(0.0, 1.0 - abs(p.y) * 7.0 - abs(p.x) * 0.9);
  float core = exp(-dot(p, p) * 14.0);
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.82), (rays * 0.8 + core) * uA);
}`;

type State = 'tangled' | 'snip' | 'free';

/**
 * Snap's good deed in the kelp forest: a little fish caught in fishing line.
 * The submarine's pincer snips the line, and the fish spins free and follows.
 */
export class NetFish {
  state: State = 'tangled';
  private since = 0;
  private fish: THREE.Mesh;
  private fu: Record<string, THREE.IUniform>;
  private spark: THREE.Mesh;
  private su: Record<string, THREE.IUniform>;
  private line: THREE.Line;
  private linePts = new Float32Array(40 * 3);
  private pos = { x: 0, y: 0, vx: 0, rot: 0 };
  private ready = false;
  /** Where the fish is on screen while tangled, for the "free the fish" button. */
  readonly at = { x: -999, y: -999, on: false };

  constructor(stage: Stage) {
    this.fu = { uMap: { value: null }, uRect: { value: new THREE.Vector4() }, uOpacity: { value: 0 }, uFlip: { value: -1 }, ...LOOK };
    const fg = new THREE.PlaneGeometry(1, 1);
    this.fish = new THREE.Mesh(fg, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FISH_FRAG, uniforms: this.fu, transparent: true, depthTest: false, depthWrite: false }));
    this.fish.renderOrder = 6;
    this.su = { uA: { value: 0 } };
    this.spark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SPARK_FRAG, uniforms: this.su, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.spark.renderOrder = 7;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePts, 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#e8e2cf', transparent: true, opacity: 0.85, depthTest: false }));
    this.line.renderOrder = 6;
    this.line.frustumCulled = false;
    for (const m of [this.fish, this.spark, this.line]) { m.visible = false; m.frustumCulled = false; stage.scene.add(m); }
  }

  async load() {
    this.fu.uMap.value = imageTexture(await loadPicture('fish'));
    const [x, y, w, h] = media.fish.rects.jpeg;
    this.fu.uRect.value.set(x / media.fish.w, 1 - (y + h) / media.fish.h, w / media.fish.w, h / media.fish.h);
    this.ready = true;
  }

  snip(t: number) {
    if (this.state !== 'tangled') return;
    this.state = 'snip';
    this.since = t;
  }

  reset() { this.state = 'tangled'; this.pos.x = 0; }

  update(dt: number, t: number, o: { vis: number; hold: [number, number]; size: number; follow: number; auto: boolean }) {
    const on = this.ready && o.vis > 0.01;
    this.fish.visible = on;
    this.at.on = on && this.state === 'tangled';
    if (!on) { this.line.visible = this.spark.visible = false; return; }
    if (o.auto) this.snip(t);
    const s = o.size;
    // Caught just off Snap's right claw.
    const home: [number, number] = [o.hold[0] + s * 7, o.hold[1] + s * 1.6];
    const age = t - this.since;
    const p = this.pos;
    if (!p.x) { p.x = home[0]; p.y = home[1]; }

    if (this.state === 'tangled') {
      p.x = home[0] + Math.sin(t * 7) * s * 0.06;
      p.y = home[1];
      p.rot = Math.sin(t * 5.5) * 0.25;
    } else if (this.state === 'snip') {
      p.rot += dt * 14 * (1 - clamp(age / 0.8));
      p.y -= dt * s * 0.6;
      if (age > 0.8) { this.state = 'free'; this.since = t; }
    } else {
      // Free: it swims loops around Snap's right side for a while.
      const a = t * 0.9;
      const tx = o.hold[0] + s * 6.6 + Math.cos(a) * s * 2.2, ty = o.hold[1] + s * 1.4 + Math.sin(a * 1.3) * s * 1.5;
      const nx = p.x + (tx - p.x) * clamp(dt * 1.8);
      p.vx = (nx - p.x) / Math.max(dt, 1e-3);
      p.x = nx;
      p.y += (ty - p.y) * clamp(dt * 1.8);
      p.rot = Math.sin(t * 3) * 0.08;
      if (Math.abs(p.vx) > 6) this.fu.uFlip.value = p.vx > 0 ? 1 : -1;
    }
    const fw = s * 1.9, fh = fw * (media.fish.rects.jpeg[3] / media.fish.rects.jpeg[2]);
    this.fish.position.set(p.x, -p.y, 0);
    this.fish.rotation.z = -p.rot;
    this.fish.scale.set(fw, fh, 1);
    this.fu.uOpacity.value = o.vis * (this.state === 'free' ? o.follow : 1);
    this.at.x = p.x; this.at.y = p.y;

    // The fishing line: from above the screen down to the fish, wrapped round it.
    const tangled = this.state === 'tangled';
    const cut = this.state === 'snip' ? clamp(age / 0.5) : this.state === 'free' ? 1 : 0;
    this.line.visible = cut < 1;
    if (this.line.visible) {
      const L = this.linePts, n = 40;
      const topX = home[0] + s * 0.8, topY = -40;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        let x: number, y: number;
        if (f < 0.6) {
          // the line from above, swaying, recoiling upward once cut
          const g = f / 0.6;
          x = topX + (home[0] - topX) * g + Math.sin(t * 1.3 + g * 3) * s * 0.15 * g;
          y = topY + (home[1] - s * 0.4 - topY) * g * (1 - cut * 0.7);
        } else {
          // loops around the fish's body
          const g = (f - 0.6) / 0.4;
          const ang = g * Math.PI * 3.2 + 1.2;
          x = p.x + Math.cos(ang) * fw * (0.32 - g * 0.06) * (tangled ? 1 : 1 + cut * 2);
          y = p.y + Math.sin(ang) * fh * 0.42 + (g - 0.5) * fh * 0.2;
        }
        L[i * 3] = x; L[i * 3 + 1] = -y; L[i * 3 + 2] = 0;
      }
      this.line.geometry.attributes.position.needsUpdate = true;
      (this.line.material as THREE.LineBasicMaterial).opacity = 0.85 * (1 - cut) * o.vis;
    }

    // The sparkle where the pincer cuts the line, just above the fish.
    const sp = this.state === 'snip' ? 1 - clamp(age / 0.45) : 0;
    this.spark.visible = sp > 0;
    this.su.uA.value = sp;
    const ss = s * (1.2 + (1 - sp) * 1.4);
    this.spark.position.set(home[0] - s * 0.2, -(home[1] - fh * 0.55), 0);
    this.spark.scale.set(ss, ss, 1);
  }
}
