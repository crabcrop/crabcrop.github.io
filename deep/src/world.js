// What is in the world, and what of it is worth drawing from where the camera is. Under
// water nothing is seen from far: each thing is switched off beyond the distance at which
// the water has taken it anyway, which is most of the world most of the time.
import { InstancedBufferAttribute, InstancedBufferGeometry, Matrix4, Sphere, Vector3 } from 'three/webgpu';

const things = [];      // { o, x, y, z, r, range }
const sphere = new Sphere(), centre = new Vector3();

export function makeWorld(scene) {
  // Put an object in the world. `range` is how far away it can still be seen, in metres,
  // measured from its bounding sphere.
  return function add(o, range = 110) {
    o.updateMatrixWorld(true);
    if (o.isMesh) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sphere.copy(o.geometry.boundingSphere);
      sphere.applyMatrix4(o.matrixWorld);
    } else {
      // a group: the sphere its caller gave it
      sphere.center.copy(o.userData.centre || centre.setFromMatrixPosition(o.matrixWorld)); sphere.radius = o.userData.radius || 10;
    }
    scene.add(o);
    things.push({ o, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, range });
    return o;
  };
}

// Once a frame: switch each thing on or off by how far it is.
export function cull(cam) {
  const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
  for (let i = 0; i < things.length; i++) {
    const t = things[i], dx = t.x - cx, dy = t.y - cy, dz = t.z - cz, lim = t.range + t.r;
    t.o.visible = dx * dx + dy * dy + dz * dz < lim * lim;
  }
}
export const worldSize = () => things.length;

// Many copies of one shape, each with its own placement (see material's `instanced`):
// `places` holds 12 numbers per copy, the top three rows of its matrix (row by row);
// `extra` names more per-copy attributes, { name: [size, Float32Array] }. The bounding
// sphere holds every copy.
export function instanced(base, places, extra = {}) {
  const n = places.length / 12;
  const geo = new InstancedBufferGeometry();
  geo.setIndex(base.index);
  for (const k of ['position', 'normal', 'uv', 'aux']) if (base.getAttribute(k)) geo.setAttribute(k, base.getAttribute(k));
  const rows = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, big = 0;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) rows[r][i * 4 + c] = places[i * 12 + r * 4 + c];
    const x = places[i * 12 + 3], y = places[i * 12 + 7], z = places[i * 12 + 11];
    const s = Math.hypot(places[i * 12], places[i * 12 + 4], places[i * 12 + 8]);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    big = Math.max(big, s);
  }
  geo.setAttribute('i0', new InstancedBufferAttribute(rows[0], 4));
  geo.setAttribute('i1', new InstancedBufferAttribute(rows[1], 4));
  geo.setAttribute('i2', new InstancedBufferAttribute(rows[2], 4));
  for (const [name, [size, data]] of Object.entries(extra)) geo.setAttribute(name, new InstancedBufferAttribute(data, size));
  geo.instanceCount = n;
  if (!base.boundingSphere) base.computeBoundingSphere();
  geo.boundingSphere = new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + base.boundingSphere.radius * big + base.boundingSphere.center.length() * big);
  return geo;
}
// The 12 numbers of a placement from a position, a rotation and a scale, appended to `out`.
export function place(out, pos, quat, scl) {
  _m.compose(pos, quat, scl);
  const e = _m.elements;   // column-major
  out.push(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]);
  return out;
}
const _m = new Matrix4();
