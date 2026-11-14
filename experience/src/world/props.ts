import * as THREE from 'three';
import { loadPicture } from '../media';
import { imageTexture, quad, place, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vAt;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vAt = vec2(wp.x, -wp.y);                      // where this is on screen, CSS px, y down
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uFlip, uHaze, uWaterY, uSub, uTime;
uniform vec3 uGrade, uWater, uSea;
varying vec2 vUv;
varying vec2 vAt;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vec2(uFlip > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y));
  if (c.a < 0.01) discard;
  // seen through water: graded, and hazed toward the water's colour
  vec3 col = mix(c.rgb * uGrade, uWater, uHaze);
  col = applyLook(col);
  // Floating at the surface (uSub > 0): below the waterline, with its ripple, it takes on the sea's colour,
  // and foam runs along the line (the same as Snap in 3D).
  if (uSub > 0.0) {
    float wy = uWaterY + sin(vAt.x * 0.045 + uTime * 2.2) * 1.8;
    float below = smoothstep(wy - 1.0, wy + 1.0, vAt.y);
    vec3 deep = mix(col, uSea, 0.3) * vec3(0.92, 1.0, 1.0);
    col = mix(col, deep, below * uSub);
    float foam = (1.0 - smoothstep(0.0, 2.4, abs(vAt.y - wy))) * uSub;
    col = mix(col, vec3(0.93, 0.98, 1.0), foam * 0.6 * step(0.5, c.a));
  }
  gl_FragColor = vec4(col, c.a * uOpacity);
}`;

/**
 * A cutout set into the world: the anchor on the sand, a pier post passing
 * close to the camera, the submarine. grade tints it, haze mixes it
 * toward the water's colour (how far away it sits in the water), and
 * sea() gives it a waterline to float at.
 */
export class Prop {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  ready = false;
  /** Where its top-left corner and size were last put, and its turn, for at(). */
  private box = { x: 0, y: 0, w: 1, h: 1, rot: 0 };

  constructor(stage: Stage, private name: string, order: number, o: { grade?: [number, number, number]; haze?: number; water?: [number, number, number] } = {}) {
    this.u = {
      uMap: { value: null }, uOpacity: { value: 1 }, uFlip: { value: 0 }, uHaze: { value: o.haze ?? 0 },
      uGrade: { value: new THREE.Vector3(...(o.grade ?? [1, 1, 1])) }, uWater: { value: new THREE.Vector3(...(o.water ?? [0.2, 0.62, 0.66])) },
      uWaterY: { value: 1e5 }, uSub: { value: 0 }, uSea: { value: new THREE.Vector3(0.36, 0.76, 0.79) }, uTime: { value: 0 }, ...LOOK,
    };
    this.mesh = quad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false }), order);
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  async load() {
    this.u.uMap.value = imageTexture(await loadPicture(this.name));
    this.ready = true;
  }

  /** Draw it with its top-left corner at (x, y), w by h px, turned by rot about that corner; opacity 0 hides it. */
  put(x: number, y: number, w: number, h: number, opacity = 1, flip = false, rot = 0) {
    const on = this.ready && opacity > 0.01;
    this.mesh.visible = on;
    this.box = { x, y, w, h, rot };
    if (!on) return;
    place(this.mesh, x, y, w, h, rot);
    this.u.uOpacity.value = opacity;
    this.u.uFlip.value = flip ? 1 : 0;
  }

  /**
   * Draw it w by h px with its point (u, v) (shares of the sprite) at (x, y)
   * on screen, turned by rot about that point (clockwise, radians).
   */
  pin(x: number, y: number, u: number, v: number, w: number, h: number, rot = 0, opacity = 1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    this.put(x - (u * w * c - v * h * s), y - (u * w * s + v * h * c), w, h, opacity, false, rot);
  }

  /** Where a point of the sprite (shares of it) is on screen, as it was last put. */
  at(u: number, v: number): [number, number] {
    const { x, y, w, h, rot } = this.box, c = Math.cos(rot), s = Math.sin(rot);
    return [x + u * w * c - v * h * s, y + u * w * s + v * h * c];
  }

  grade(r: number, g: number, b: number) { this.u.uGrade.value.set(r, g, b); }
  /** How much of the water's colour it takes on, and that colour. */
  haze(amount: number, water?: [number, number, number]) { this.u.uHaze.value = amount; if (water) this.u.uWater.value.set(...water); }
  /** The water's surface on screen (px from the top; null for none), how much of the sea's colour it takes below it, and that colour. */
  sea(y: number | null, amount: number, colour?: readonly [number, number, number], t = 0) {
    this.u.uWaterY.value = y ?? 1e5;
    this.u.uSub.value = y === null ? 0 : amount;
    if (colour) this.u.uSea.value.set(...colour);
    this.u.uTime.value = t;
  }
  hide() { this.mesh.visible = false; }
}

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform float uA;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = exp(-r * r * 9.0) + 0.35 * exp(-r * r * 2.5);
  gl_FragColor = vec4(uTint, a * uA);
}`;

/** A soft pool of light, added over what is behind it: the submarine's lamp in dark water. */
export class Glow {
  private mesh: THREE.Mesh;
  private u = { uA: { value: 0 }, uTint: { value: new THREE.Vector3(1, 0.88, 0.62) } };

  constructor(stage: Stage, order: number) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: GLOW_FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.mesh.renderOrder = order;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  /** Its middle at (x, y), size px across, a how bright (0 hides it). */
  put(x: number, y: number, size: number, a: number) {
    this.mesh.visible = a > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.position.set(x, -y, 0);
    this.mesh.scale.set(size, size, 1);
    this.u.uA.value = a;
  }
}
