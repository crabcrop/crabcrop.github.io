import * as THREE from 'three';
import type { Stage } from './stage';

const VERT = /* glsl */ `
attribute float aA;
attribute float aWarm;
varying vec2 vUv;
varying float vA;
varying float vWarm;
void main() { vUv = uv; vA = aA; vWarm = aWarm; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

// A speck of dust: a soft dot, cool in the porthole light, warm near the lantern.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vA;
varying float vWarm;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(mix(vec3(0.82, 0.95, 1.0), vec3(1.0, 0.8, 0.5), vWarm), a * a * vA);
}`;

const N = 90;

/** Dust drifting in the wreck's cabin: it rises slowly, glints in the lantern's light and swirls away from the cursor. */
export class Motes {
  readonly mesh: THREE.InstancedMesh;
  private aA: THREE.InstancedBufferAttribute;
  private aWarm: THREE.InstancedBufferAttribute;
  private m = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), vx: 0, vy: 0, ph: Math.random() * 6.28 }));
  private dummy = new THREE.Object3D();

  constructor(stage: Stage) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    this.aWarm = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    geo.setAttribute('aA', this.aA);
    geo.setAttribute('aWarm', this.aWarm);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  /** vis fades them in and out; light is the lantern (x, y, radius px), mouse the cursor. */
  update(dt: number, t: number, o: { vis: number; w: number; h: number; light: [number, number, number] | null; mouse: [number, number] | null }) {
    this.mesh.visible = o.vis > 0.01;
    if (!this.mesh.visible) return;
    const { w, h } = o;
    const d = this.dummy;
    for (let i = 0; i < N; i++) {
      const p = this.m[i];
      let x = p.x * w, y = p.y * h;
      // A slow rise with a lazy sideways wander, faster for the near ones.
      const drift = 6 + 14 * p.z;
      let ax = Math.sin(t * 0.37 + p.ph) * 4, ay = -drift * 0.35;
      if (o.mouse) {
        const dx = x - o.mouse[0], dy = y - o.mouse[1], r = Math.hypot(dx, dy), R = 150;
        if (r < R && r > 1) {
          const f = (1 - r / R) * 160;
          // pushed away and swirled round
          ax += (dx / r) * f - (dy / r) * f * 0.6;
          ay += (dy / r) * f + (dx / r) * f * 0.6;
        }
      }
      p.vx += (ax - p.vx * 1.6) * dt;
      p.vy += (ay - p.vy * 1.6) * dt;
      x += p.vx * dt * (0.6 + p.z);
      y += p.vy * dt * (0.6 + p.z) - drift * 0.25 * dt;
      // round the edges
      if (y < -20) { y = h + 20; x = Math.random() * w; }
      if (x < -20) x = w + 20; else if (x > w + 20) x = -20;
      p.x = x / w; p.y = y / h;
      let warm = 0, lit = 0;
      if (o.light) {
        const lx = x - o.light[0], ly = y - o.light[1];
        lit = Math.exp(-(lx * lx + ly * ly) / (o.light[2] * o.light[2]));
        warm = Math.min(1, lit * 1.6);
      }
      const tw = 0.5 + 0.5 * Math.sin(t * (1.1 + p.z) + p.ph * 3);
      this.aA.setX(i, o.vis * (0.12 + 0.22 * tw * (1 - p.z * 0.5) + 0.75 * lit));
      this.aWarm.setX(i, warm);
      // near ones are bigger and softer
      const s = (1.6 + 5.5 * p.z * p.z) * (h / 900);
      d.position.set(x, -y, 0);
      d.scale.set(s, s, 1);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.aA.needsUpdate = true;
    this.aWarm.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
