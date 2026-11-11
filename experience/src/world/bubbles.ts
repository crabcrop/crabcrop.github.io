import * as THREE from 'three';
import type { Stage } from './stage';

const VERT = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vA;
void main() { vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

// A soft ring with a highlight, like a bubble in a macro shot.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ring = smoothstep(0.62, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float hi = smoothstep(0.32, 0.0, length(p - vec2(-0.35, 0.38)));
  float a = (ring * 0.75 + hi * 0.9 + 0.08) * vA;
  gl_FragColor = vec4(vec3(0.92, 0.99, 1.0), a);
}`;

const MAX = 160;

/** Bubbles: a burst for the plunge, and a stream from Snap on fast scrolls. */
export class Bubbles {
  readonly mesh: THREE.InstancedMesh;
  private alpha: THREE.InstancedBufferAttribute;
  private b = Array.from({ length: MAX }, () => ({ on: false, x: 0, y: 0, r: 0, vy: 0, ph: 0, age: 0, life: 0, top: -1e9 }));
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
    stage.scene.add(this.mesh);
  }

  /** A bubble at (x, y), size px; surface, when given, is the water's surface on screen, where it pops. */
  emit(x: number, y: number, size: number, spread = 1, surface = -1e9) {
    const b = this.b[this.next];
    this.next = (this.next + 1) % MAX;
    Object.assign(b, {
      on: true, x: x + (Math.random() - 0.5) * size * 2 * spread, y, r: size * (0.35 + Math.random() * 0.75),
      vy: size * (5 + Math.random() * 5), ph: Math.random() * 6.28, age: 0, life: 1.6 + Math.random() * 1.6, top: surface,
    });
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const b = this.b[i];
      const d = this.dummy;
      if (b.on) {
        b.age += dt;
        b.y -= b.vy * dt;
        b.x += Math.sin(b.age * 6 + b.ph) * b.r * 1.6 * dt;
        if (b.age > b.life || b.y < -40 || b.y < b.top) b.on = false;
      }
      const a = b.on ? Math.min(1, b.age * 4) * (1 - Math.max(0, (b.age - b.life * 0.7) / (b.life * 0.3))) : 0;
      this.alpha.setX(i, a);
      d.position.set(b.x, -b.y, 0);
      d.scale.set(b.r * 2, b.r * 2, 1);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      any ||= b.on;
    }
    this.mesh.visible = any;
    this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
