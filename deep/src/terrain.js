// The ground: one valley from the pier to the vents, drawn as slices so that what is
// behind the camera or far ahead costs nothing. Its sand and rock are shaded from the
// detail texture at three sizes, laid on along the three axes.
import { Mesh as ThreeMesh, Sphere, Vector3 } from 'three/webgpu';
import { cos, float, floor, fract, max, mix, normalize, sin, smoothstep, vec3 } from 'three/tsl';
import { centerX, floorY, groundY, rockiness } from './layout.js';
import { Mesh, clamp } from './math.js';
import { detail, hash1, material } from './shaders.js';

// What rock looks like. Shared by the ground and by every loose rock and outcrop: `p` is
// where to read the relief, `w` where the point is, `rocky` 0 for sand and 1 for rock,
// `open` how open to the sky it is.
export function rockSurf(s, p, w, rocky, open, dist) {
  const depth = w.y.negate();
  const n0 = s.n;
  const A = detail(p, n0, 0.043, 5.0), B = detail(p, n0, 0.19, 4.0), C = detail(p, n0, 0.87, 3.0);
  // (the finest relief only up close: far away it would only sparkle)
  const near = float(1).sub(smoothstep(7.0, 30.0, dist)).toVar(), mid = float(1).sub(smoothstep(20.0, 70.0, dist)).toVar();
  const hgt = A.h.mul(0.5).add(B.h.mul(0.35)).add(C.h.mul(0.15)).toVar();
  const steep = float(1).sub(smoothstep(0.50, 0.86, n0.y)).toVar();
  const rock = smoothstep(0.36, 0.60, max(rocky, steep).add(A.m.sub(0.5).mul(0.8))).toVar();

  // sand: bright and clean in the sunlit zones (cream on the reef), a little darker among the
  // kelp and on the wreck's ledge, black on the vents' plain; combed into soft ripples
  const ph = w.z.mul(2.4).add(w.x.mul(0.5)).add(A.m.mul(7.0)).add(sin(w.x.mul(0.6)).mul(1.2)).toVar();
  const rip = sin(ph).mul(0.5).add(0.5);
  const kelp = smoothstep(-48.0, -60.0, w.z).mul(float(1).sub(smoothstep(-118.0, -128.0, w.z)));
  const cream = mix(vec3(0.92, 0.86, 0.72), vec3(0.80, 0.74, 0.60), B.m);
  const shade = mix(vec3(0.66, 0.62, 0.48), vec3(0.56, 0.52, 0.40), B.m);
  const black = mix(vec3(0.07, 0.065, 0.075), vec3(0.12, 0.11, 0.11), B.m);
  const sand = mix(mix(cream, shade, max(kelp, smoothstep(40.0, 52.0, depth))), black, smoothstep(120.0, 185.0, depth))
    .mul(rip.mul(0.16).add(0.88)).mul(C.h.sub(0.45).mul(near).mul(0.25).add(0.94));
  const nSand = normalize(n0.add(vec3(0.03, 0.0, 0.16).mul(cos(ph)).mul(mid)).add(C.n.sub(n0).mul(0.2).mul(near)));

  // rock, where the floor is steep (the drop-off): smooth and dark, black in the deep
  const st = w.y.mul(0.5).add(A.h.mul(1.7)).add(A.m.mul(4.5)).toVar();
  const bed = hash1(floor(st).mul(0.137).add(0.31)).toVar();
  const rk = mix(vec3(0.20, 0.19, 0.18), vec3(0.34, 0.31, 0.27), bed.mul(0.75).add(B.m.mul(0.25))).toVar();
  rk.assign(mix(rk, vec3(0.045, 0.045, 0.05).mul(bed.mul(0.8).add(0.6)), smoothstep(64.0, 100.0, depth)));
  rk.mulAssign(hgt.mul(1.1).add(0.4));
  const grow = float(0.0), alive = float(0.0);
  const nRock = normalize(n0.add(A.n.sub(n0).mul(0.6)).add(B.n.sub(n0).mul(0.45).mul(mid.mul(0.7).add(0.3))).add(C.n.sub(n0).mul(0.3).mul(near)));

  s.albedo = mix(sand, rk, rock);
  s.n = normalize(mix(nSand, nRock, rock)).toVar();
  s.ao = open.mul(mix(float(1), smoothstep(0.12, 0.6, hgt), rock.mul(0.8)));
  s.spec = mix(float(0.04), float(0.08), rock).mul(near);
  s.gloss = mix(float(14.0), float(30.0), rock);
  s.fluor = grow.mul(alive);
}

// Loose rock: all rock, darker toward its foot.
export function rockMaterial() {
  return material({ instanced: true, fade: [80, 98], surface: (s, f) => rockSurf(s, f.w, f.w, float(1.0), smoothstep(-0.6, 0.5, f.n.y).mul(0.5).add(0.5), f.dist) });
}

export function terrainMaterial() {
  return material({ aux: true, fade: [132, 158], surface: (s, f) => rockSurf(s, f.w, f.w, f.aux.x, f.aux.y, f.dist) });
}

// How rocky the ground is at a place: the zone's own share, and all rock up the walls.
export const rockyAt = (x, z) => clamp(rockiness(z) + clamp((Math.abs(x - centerX(z)) - 12) / 14, 0, 1), 0, 1);

// Build the slices. `step` is the size of a cell on the ground in metres.
export function buildTerrain(add, q, onProgress) {
  const step = q.amount >= 1 ? 0.95 : q.amount >= 0.5 ? 1.3 : 1.8;
  const cols = q.amount >= 1 ? 104 : q.amount >= 0.5 ? 80 : 60;
  const halfW = 76;
  // rows: closer together where the floor is steep, so the cliff gets its share
  const rowsZ = [];
  for (let z = 58; z > -452;) {
    rowsZ.push(z);
    const slope = (floorY(z - 0.25) - floorY(z + 0.25)) / 0.5;
    z -= Math.max(step / Math.sqrt(1 + slope * slope), 0.03);
  }
  const mat = terrainMaterial();
  const per = 22, slices = [];
  for (let r0 = 0; r0 < rowsZ.length - 1; r0 += per) {
    const r1 = Math.min(r0 + per, rowsZ.length - 1);
    const m = new Mesh(true);
    let minY = 1e9, maxY = -1e9;
    m.grid(cols, r1 - r0, (s, t, o) => {
      const z = rowsZ[Math.min(r0 + Math.round(t * (r1 - r0)), rowsZ.length - 1)];
      const u = s * 2 - 1;
      // across: cells are small in the middle of the valley and grow toward the rims
      const x = centerX(z) + Math.sign(u) * Math.pow(Math.abs(u), 1.55) * halfW;
      const y = groundY(x, z);
      o[0] = x; o[1] = y; o[2] = z;
      o[3] = rockyAt(x, z);
      // open ground is lit, hollows are darker: how far this point sits above the floor's own level
      o[4] = clamp(0.62 + (y - floorY(z)) * 0.06, 0.4, 1);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }, false, false);
    const geo = m.build();
    const zA = rowsZ[r0], zB = rowsZ[r1];
    geo.boundingSphere = new Sphere(new Vector3(centerX((zA + zB) / 2), (minY + maxY) / 2, (zA + zB) / 2), Math.hypot(halfW, (maxY - minY) / 2, (zA - zB) / 2) + 2);
    const mesh = new ThreeMesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, 160);
    slices.push(mesh);
    if (onProgress) onProgress(r1 / (rowsZ.length - 1));
  }
  return { slices, material: mat };
}
