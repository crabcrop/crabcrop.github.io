// Only to measure: how much a page that uses three.js's WebGPU renderer and its shading
// language (TSL) weighs once bundled, next to the WebGL build the prototype uses now.
import { WebGPURenderer, MeshStandardNodeMaterial, Mesh, BoxGeometry, Scene, PerspectiveCamera, InstancedMesh } from 'three/webgpu';
import { uniform, positionLocal, sin, time, vec3, color, mix, storage, instanceIndex, Fn, compute } from 'three/tsl';

const r = new WebGPURenderer({ antialias: true });
const m = new MeshStandardNodeMaterial();
const u = uniform(1);
m.positionNode = positionLocal.add(vec3(sin(time.mul(u)), 0, 0));
m.colorNode = mix(color(0xff0000), color(0x0000ff), sin(time).mul(0.5).add(0.5));
const s = new Scene();
s.add(new Mesh(new BoxGeometry(), m), new InstancedMesh(new BoxGeometry(), m, 10));
const step = Fn(() => { instanceIndex.toVar(); })().compute(64);
r.init().then(() => { r.compute(step); r.render(s, new PerspectiveCamera()); });
window.__keep = [storage, compute];
