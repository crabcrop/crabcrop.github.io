import * as THREE from 'three';
import type { Stage } from './stage';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// A four-point star with a soft core.
const FRAG = /* glsl */ `
precision highp float;
uniform float uA;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float rays = max(0.0, 1.0 - abs(p.x) * 7.0 - abs(p.y) * 0.9) + max(0.0, 1.0 - abs(p.y) * 7.0 - abs(p.x) * 0.9);
  float core = exp(-dot(p, p) * 14.0);
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.82), (rays * 0.8 + core) * uA);
}`;

/** Little star bursts: Snap catching the chain, his claw clicking. */
export class Sparkles {
  private pool: { m: THREE.Mesh; u: { uA: THREE.IUniform<number> }; t0: number; x: number; y: number; s: number; spin: number }[] = [];
  private t = 0;

  constructor(stage: Stage) {
    for (let i = 0; i < 8; i++) {
      const u = { uA: { value: 0 } };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = 7;
      m.frustumCulled = false;
      m.visible = false;
      stage.scene.add(m);
      this.pool.push({ m, u, t0: -10, x: 0, y: 0, s: 0, spin: 0 });
    }
  }

  /** A burst of n stars around (x, y), size s px. */
  burst(x: number, y: number, s: number, n = 3) {
    for (let k = 0; k < n; k++) {
      const p = this.pool.reduce((a, b) => (a.t0 < b.t0 ? a : b));
      const a = Math.random() * Math.PI * 2, r = k ? s * (0.3 + Math.random() * 0.5) : 0;
      Object.assign(p, { t0: this.t + k * 0.05, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, s: s * (k ? 0.55 : 1), spin: (Math.random() - 0.5) * 2 });
    }
  }

  update(t: number) {
    this.t = t;
    for (const p of this.pool) {
      const age = t - p.t0;
      const on = age >= 0 && age < 0.5;
      p.m.visible = on;
      if (!on) continue;
      const a = age < 0.08 ? age / 0.08 : 1 - (age - 0.08) / 0.42;
      p.u.uA.value = a;
      const s = p.s * (0.6 + age * 1.4);
      p.m.position.set(p.x, -p.y, 0);
      p.m.rotation.z = p.spin * age;
      p.m.scale.set(s, s, 1);
    }
  }
}
