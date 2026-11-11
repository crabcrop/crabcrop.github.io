import * as THREE from 'three';
import type { Stage } from './stage';

const VERT = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vA;
void main() { vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

// A drop of water: clear, with a bright rim and a highlight.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float body = 0.35 * (1.0 - r);
  float rim = smoothstep(0.55, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
  float hi = smoothstep(0.35, 0.0, length(p - vec2(-0.3, 0.35)));
  gl_FragColor = vec4(vec3(0.93, 0.98, 1.0), (body + rim * 0.7 + hi) * vA);
}`;

const MAX = 90;

/** Water thrown up where Snap hits the surface: drops that arc up and fall back in. */
export class Splash {
  readonly mesh: THREE.InstancedMesh;
  private alpha: THREE.InstancedBufferAttribute;
  private d = Array.from({ length: MAX }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, age: 0, water: 0, g: 0 }));
  private dummy = new THREE.Object3D();
  private next = 0;

  constructor(stage: Stage) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aAlpha', this.alpha);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  /** n drops from a splash at (x, y) on the surface, size px across: a crown of fast ones and a spray of fine ones. */
  burst(x: number, y: number, size: number, n = 34) {
    for (let k = 0; k < n; k++) {
      const p = this.d[this.next];
      this.next = (this.next + 1) % MAX;
      const crown = k < n * 0.45;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * (crown ? 1.5 : 2.4);
      const v = size * (crown ? 3.2 + Math.random() * 1.6 : 1.6 + Math.random() * 2.2);
      Object.assign(p, {
        on: true, x: x + (Math.random() - 0.5) * size * 0.5, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: size * (crown ? 0.05 + Math.random() * 0.05 : 0.025 + Math.random() * 0.03), age: 0, water: y, g: size * 9,
      });
    }
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const p = this.d[i];
      if (p.on) {
        p.age += dt;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // back into the water, or gone
        if ((p.vy > 0 && p.y > p.water) || p.age > 2.5) p.on = false;
      }
      const a = p.on ? Math.min(1, p.age * 12) * (1 - Math.min(1, Math.max(0, p.age - 1.2) / 0.6)) : 0;
      this.alpha.setX(i, a);
      const d = this.dummy;
      d.position.set(p.x, -p.y, 0);
      // stretched along its flight
      const sp = Math.hypot(p.vx, p.vy);
      d.rotation.set(0, 0, Math.atan2(-p.vy, p.vx));
      d.scale.set(p.r * 2 * (1 + Math.min(1.6, sp / (p.g * 0.6 + 1))), p.r * 2, 1);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      any ||= p.on;
    }
    this.mesh.visible = any;
    this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
