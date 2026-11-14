import * as THREE from 'three';

/** A plate drawn to cover the viewport: top-left corner and size, in CSS px. */
export interface Cover { ox: number; oy: number; dw: number; dh: number }

/**
 * Cover-fit a plate of pw×ph over a vw×vh viewport, scaled up by `over` so
 * there is room to pan. fx and fy pick which part stays in view (0 to 1).
 */
export function cover(pw: number, ph: number, vw: number, vh: number, over = 1.08, fx = 0.5, fy = 0.5): Cover {
  const s = Math.max(vw / pw, vh / ph) * over;
  const dw = pw * s;
  const dh = ph * s;
  return { ox: (vw - dw) * fx, oy: (vh - dh) * fy, dw, dh };
}

export const onPlate = (c: Cover, u: number, v: number): [number, number] => [c.ox + u * c.dw, c.oy + v * c.dh];

/** One WebGL canvas with an orthographic camera in CSS pixels, y down. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  w = 1;
  h = 1;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement, private maxDpr: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    // (asking a shader for its error log waits for it to finish compiling: only while developing)
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.resize();
  }

  /**
   * Have the shaders of everything in the scene (or of one object in it)
   * built now, in the background, and say when they are ready. Left to
   * itself each one is built on the frame its layer first shows, which
   * stalls that frame: tens of milliseconds, more on some machines. One
   * layer at a time: a browser that builds them on its drawing thread
   * after all is then held up a little at a time, not once for the lot.
   * Where the browser cannot say when a shader is ready, each is started
   * and given a moment.
   */
  async warm(object: THREE.Object3D = this.scene) {
    const layers: THREE.Object3D[] = [];
    object.traverse((o) => { if ((o as THREE.Mesh).material) layers.push(o); });
    const told = this.renderer.extensions.has('KHR_parallel_shader_compile');
    for (const o of layers) {
      try {
        if (told) await this.renderer.compileAsync(o, this.camera, this.scene);
        else { this.renderer.compile(o, this.camera, this.scene); await new Promise((r) => setTimeout(r, 120)); }
      } catch { /* it is built when it is first drawn, as before */ }
    }
  }

  resize() {
    this.w = innerWidth;
    this.h = innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.right = this.w;
    this.camera.bottom = -this.h;
    this.camera.updateProjectionMatrix();
  }

  setMaxDpr(d: number) {
    this.maxDpr = d;
    this.resize();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

/** A unit quad whose origin is its top-left corner, for 2D layers. */
export function quad(material: THREE.Material, order: number) {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0.5, -0.5, 0);
  const m = new THREE.Mesh(g, material);
  m.renderOrder = order;
  m.frustumCulled = false;
  return m;
}

/** Place a top-left-origin quad at (x, y) with size (w, h), y down. */
export function place(m: THREE.Object3D, x: number, y: number, w: number, h: number, rot = 0) {
  m.position.set(x, -y, 0);
  m.scale.set(w, h, 1);
  m.rotation.z = -rot;
}

export function imageTexture(img: TexImageSource | HTMLImageElement) {
  const t = new THREE.Texture(img as HTMLImageElement);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function videoTexture(v: HTMLVideoElement) {
  const t = new THREE.VideoTexture(v);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
