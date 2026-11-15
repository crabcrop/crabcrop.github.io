// The ground: one valley from the pier to the vents, drawn as slices so that what is
// behind the camera or far ahead costs nothing. Its sand and rock are shaded from the
// detail texture at three sizes, laid on along the three axes.
import { Mesh as ThreeMesh, Sphere, Vector3 } from 'three';
import { centerX, floorY, groundY, rockiness } from './layout.js';
import { Mesh, clamp } from './math.js';
import { material } from './shaders.js';

// What rock looks like. Shared by the ground and by every loose rock and outcrop: `p` is
// where to read the relief (the world for the ground, the rock's own space for a rock that
// is turned), `rocky` is 0 for sand and 1 for rock, `open` is how open to the sky it is.
export const ROCK = /* glsl */ `
void rockSurf(inout Surf s, vec3 p, vec3 wpos, float rocky, float open) {
  float depth = -wpos.y;
  float dist = length(wpos - cameraPosition);
  vec3 n0 = s.n;
  vec2 hA, hB, hC;
  vec3 nA = detail(p, n0, 0.043, 5.0, hA);
  vec3 nB = detail(p, n0, 0.19, 4.0, hB);
  vec3 nC = detail(p, n0, 0.87, 3.0, hC);
  // (the finest relief only up close: far away it would only sparkle)
  float near = 1.0 - smoothstep(7.0, 30.0, dist), mid = 1.0 - smoothstep(20.0, 70.0, dist);
  float hgt = hA.x * 0.5 + hB.x * 0.35 + hC.x * 0.15;
  float steep = 1.0 - smoothstep(0.50, 0.86, n0.y);
  float rock = smoothstep(0.36, 0.60, max(rocky, steep) + (hA.y - 0.5) * 0.8);

  // sand: pale and warm, combed into ripples by the current
  float ph = wpos.z * 2.4 + wpos.x * 0.5 + 7.0 * hA.y + 1.2 * sin(wpos.x * 0.6);
  float rip = sin(ph) * 0.5 + 0.5;
  vec3 sand = mix(vec3(0.60, 0.53, 0.39), vec3(0.40, 0.36, 0.27), hB.y) * (0.82 + 0.26 * rip) * (0.9 + 0.32 * (hC.x - 0.45) * near);
  vec3 nSand = normalize(n0 + vec3(0.03, 0.0, 0.16) * cos(ph) * mid + (nC - n0) * 0.25 * near);

  // rock: dark, in beds, with a groove at the foot of each bed on steep faces
  float st = wpos.y * 0.5 + hA.x * 1.7 + hA.y * 4.5;
  float bed = hash1(floor(st) * 0.137 + 0.31);
  vec3 rk = mix(vec3(0.115, 0.105, 0.095), vec3(0.30, 0.255, 0.20), bed * 0.75 + hB.y * 0.25);
  rk *= 1.0 - 0.45 * steep * (1.0 - smoothstep(0.0, 0.16, fract(st)));
  // what grows on rock that faces up: olive in the kelp, rose and violet crust on the reef
  float grow = smoothstep(0.2, 0.75, n0.y) * smoothstep(0.47, 0.53, hB.y * 0.45 + hC.y * 0.2 + hB.x * 0.35);
  vec3 crust = mix(vec3(0.20, 0.25, 0.09), mix(vec3(0.46, 0.13, 0.26), vec3(0.30, 0.16, 0.46), hash1(floor(st * 3.0) * 0.071)), smoothstep(21.0, 30.0, depth));
  float alive = smoothstep(8.0, 14.0, depth) * (1.0 - smoothstep(52.0, 72.0, depth));
  rk = mix(rk, crust, grow * alive);
  // the deep: black basalt
  rk = mix(rk, vec3(0.035, 0.036, 0.042) * (0.6 + 0.8 * bed), smoothstep(64.0, 100.0, depth));
  rk *= 0.22 + 1.3 * hgt;                                    // hollows are darker
  vec3 nRock = normalize(n0 + (nA - n0) * 0.85 + (nB - n0) * 0.65 * (0.3 + 0.7 * mid) + (nC - n0) * 0.5 * near);

  s.albedo = mix(sand, rk, rock);
  s.n = normalize(mix(nSand, nRock, rock));
  s.ao = open * mix(1.0, smoothstep(0.12, 0.6, hgt), rock * 0.8);
  s.spec = mix(0.05, 0.10, rock) * near; s.gloss = mix(14.0, 30.0, rock);
  s.fluor = 0.45 * grow * alive * rock;
}
`;

// Loose rock: all rock, darker toward its foot.
export function rockMaterial() {
  return material({ frag: ROCK, surf: /* glsl */ `rockSurf(s, vW, vW, 1.0, 0.5 + 0.5 * smoothstep(-0.6, 0.5, s.n.y));` });
}

export function terrainMaterial() {
  return material({
    aux: true,
    frag: ROCK,
    surf: /* glsl */ `rockSurf(s, vW, vW, vAux.x, vAux.y);`,
  });
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
    add(mesh, 150);
    slices.push(mesh);
    if (onProgress) onProgress(r1 / (rowsZ.length - 1));
  }
  return { slices, material: mat };
}
