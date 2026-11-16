// The ground: one valley from the pier to the vents, drawn as slices so that what is
// behind the camera or far ahead costs nothing. Its sand and rock are shaded from the
// detail texture at three sizes, laid on along the three axes.
import { Mesh as ThreeMesh, Sphere, Vector3 } from 'three/webgpu';
import { clamp, cos, float, floor, fract, max, mix, normalize, sin, smoothstep, vec3 } from 'three/tsl';
import { centerX, floorY, groundY, rockiness } from './layout.js';
import { Mesh, clamp as clampJ } from './math.js';
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

  // sand: warm cream in the sunlit zones, white on the reef, a darker cream among the kelp and
  // on the wreck's ledge, black on the vents' plain; combed into soft ripples. (Light down
  // here has lost its red, so the deeper the sand, the warmer it is made, to stay cream.)
  const ph = w.z.mul(2.4).add(w.x.mul(0.5)).add(A.m.mul(7.0)).add(sin(w.x.mul(0.6)).mul(1.2)).toVar();
  const rip = sin(ph).mul(0.5).add(0.5);
  const kelp = smoothstep(-48.0, -60.0, w.z).mul(float(1).sub(smoothstep(-116.0, -126.0, w.z)));
  const reef = smoothstep(-118.0, -128.0, w.z).mul(float(1).sub(smoothstep(-194.0, -204.0, w.z)));
  // (colours as light, linear: a picture's colour to the power 2.2)
  const cream = mix(vec3(0.90, 0.73, 0.45), vec3(0.80, 0.62, 0.37), B.m);
  const white = mix(vec3(0.92, 0.87, 0.74), vec3(0.84, 0.78, 0.64), B.m);
  const shade = mix(vec3(0.70, 0.56, 0.34), vec3(0.58, 0.45, 0.27), B.m);
  const black = mix(vec3(0.014, 0.013, 0.015), vec3(0.03, 0.027, 0.028), B.m);
  const warm = vec3(float(1.0).add(clamp(depth, 0.0, 40.0).mul(0.007)), 1.0, float(1.0).sub(clamp(depth, 0.0, 40.0).mul(0.002)));
  const lit = mix(mix(cream, white, reef), shade, max(kelp.mul(0.6), smoothstep(40.0, 54.0, depth))).mul(warm);
  const sand = mix(lit, black, smoothstep(110.0, 170.0, depth))
    .mul(rip.mul(0.14).add(0.9)).mul(C.h.sub(0.45).mul(near).mul(0.25).add(0.94));
  const nSand = normalize(n0.add(vec3(0.03, 0.0, 0.16).mul(cos(ph)).mul(mid)).add(C.n.sub(n0).mul(0.2).mul(near)));

  // rock, where the floor is steep (the drop-off): grey-brown, darker below the ledge; at the
  // vents, black charcoal, crusted teal with minerals near its foot
  const st = w.y.mul(0.5).add(A.h.mul(1.7)).add(A.m.mul(4.5)).toVar();
  const bed = hash1(floor(st).mul(0.137).add(0.31)).toVar();
  const rk = mix(vec3(0.22, 0.17, 0.12), vec3(0.36, 0.29, 0.20), bed.mul(0.75).add(B.m.mul(0.25))).toVar();
  // on the reef the rock is crusted: moss green and coralline pink and purple in patches
  const onReef = smoothstep(-116.0, -126.0, w.z).mul(float(1).sub(smoothstep(-198.0, -206.0, w.z))).add(smoothstep(-246.0, -254.0, w.z).mul(float(1).sub(smoothstep(-268.0, -275.0, w.z))));
  const patch = C.m.add(B.m.mul(0.6)).toVar();
  const crustC = mix(mix(vec3(0.20, 0.30, 0.08), vec3(0.50, 0.16, 0.30), smoothstep(0.55, 0.75, A.m)), vec3(0.32, 0.16, 0.50), smoothstep(0.62, 0.8, B.m));
  rk.assign(mix(rk, crustC, smoothstep(0.75, 0.95, patch).mul(onReef).mul(smoothstep(0.1, 0.7, n0.y.add(0.3)))));
  rk.assign(mix(rk, vec3(0.07, 0.065, 0.065).mul(bed.mul(0.6).add(0.7)), smoothstep(60.0, 100.0, depth)));
  const vent = smoothstep(150.0, 185.0, depth).toVar();
  const crust = smoothstep(0.62, 0.78, B.m.add(A.m.mul(0.4)).sub(w.y.sub(-206.0).mul(0.1))).mul(vent);
  rk.assign(mix(rk, mix(vec3(0.011, 0.010, 0.012), vec3(0.04, 0.037, 0.037), hgt.mul(hgt)), vent));
  rk.assign(mix(rk, mix(vec3(0.02, 0.20, 0.16), vec3(0.06, 0.32, 0.24), C.m), crust));
  rk.mulAssign(mix(hgt.mul(1.1).add(0.4), float(1.0), vent.mul(0.5)));
  const grow = float(0.0), alive = float(0.0);
  const nRock = normalize(n0.add(A.n.sub(n0).mul(mix(0.6, 1.0, vent))).add(B.n.sub(n0).mul(mix(0.45, 0.9, vent)).mul(mid.mul(0.7).add(0.3))).add(C.n.sub(n0).mul(0.3).mul(near)));

  s.albedo = mix(sand, rk, rock);
  s.n = normalize(mix(nSand, nRock, rock)).toVar();
  s.ao = open.mul(mix(float(1), smoothstep(0.12, 0.6, hgt), rock.mul(0.8)));
  // (black sand glints; charcoal has a dull sheen that catches the vents' glow)
  s.spec = mix(mix(float(0.04), float(0.08), rock), mix(float(0.22), float(0.16), rock), vent).mul(near.mul(0.6).add(0.4));
  s.gloss = mix(mix(float(14.0), float(30.0), rock), float(22.0), vent);
  s.fluor = mix(float(0.45), float(0.1), max(rock, vent)).add(grow.mul(alive));
}

// Loose rock: all rock, darker toward its foot.
export function rockMaterial() {
  return material({ instanced: true, fade: [80, 98], surface: (s, f) => rockSurf(s, f.w, f.w, float(1.0), smoothstep(-0.6, 0.5, f.n.y).mul(0.5).add(0.5), f.dist) });
}

export function terrainMaterial() {
  return material({ aux: true, fade: [132, 158], surface: (s, f) => rockSurf(s, f.w, f.w, f.aux.x, f.aux.y, f.dist) });
}

// How rocky the ground is at a place: the zone's own share, and all rock up the walls.
export const rockyAt = (x, z) => clampJ(rockiness(z) + clampJ((Math.abs(x - centerX(z)) - 12) / 14, 0, 1), 0, 1);

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
      o[4] = clampJ(0.62 + (y - floorY(z)) * 0.06, 0.4, 1);
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
