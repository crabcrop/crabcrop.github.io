// The look. Every material in the dive is assembled here from the same pieces, so
// everything is lit by the same sun, sits in the same water, and fades the same way.
// Written in TSL, three.js's shading language: the same code becomes WGSL on WebGPU and
// GLSL on the WebGL 2 fallback.
//
//   G            the values all materials share (time, sun, water, shadow, lamp, glows)
//   material()   builds a node material from a vertex step and a surface step, and a twin
//                that only writes depth, for the shadow map
//
// The water model, in one place:
//   - Light comes down from the surface and the water takes it out as it goes, red first
//     (KD, per metre of depth). Below the ledge the dive is deeper than it is drawn, so
//     depth counts for more there (optical depth, G.opt).
//   - Along a line of sight the water takes light out again (SIG) and scatters some of
//     the light coming down into the eye. That sum has a closed form (scatterFrom), and
//     it is why looking up is bright, looking down is dark, far is blue and deep is black,
//     with no colour ramp anywhere.
//   - The sun also throws shadows (one map, drawn once) and caustics (one small texture,
//     drawn every frame), both along the same slanted ray, so they agree with the shafts.
//   - Deep down the only light is the lamp and what glows by itself.
//
// What the scene target holds: rgb is the colour, and a is how far away the surface is,
// for the light shafts. Transparent and additive materials blend their colour and leave
// that distance alone.
import {
  AddEquation, BackSide, Color, CustomBlending, DoubleSide, FrontSide, Matrix4, NodeMaterial, OneFactor, OneMinusSrcAlphaFactor,
  SrcAlphaFactor, Vector2, Vector3, Vector4, ZeroFactor,
} from 'three/webgpu';
import {
  Fn, Loop, abs, attribute, cameraPosition, clamp, dot, exp, faceDirection, float, floor, int, ivec3, length, max, min, mix,
  floor as floorN, fract, modelWorldMatrix, normalLocal, normalize, positionGeometry, positionLocal, pow, select, sign, smoothstep, sqrt, texture, uint, uniform,
  uniformArray, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { SUN } from './layout.js';

export const G = {
  time: uniform(0),
  sunDir: uniform(new Vector3(-SUN[0], -SUN[1], -SUN[2])),       // toward the sun
  sunCol: uniform(new Color(1.7, 1.6, 1.42)),
  scat: uniform(new Color(0.16, 0.58, 0.9)),                      // the colour the water scatters, at the camera
  amb: uniform(new Color(0.22, 0.6, 0.8)),                        // the colour of the light from above
  opt: uniform(new Vector4(0, 1, 60, 3.2)),                       // optical depth at the camera, its slope there, the knee, the slope below it
  light: uniform(new Vector4(1, 1, 1, 1)),                        // scales: sun, sky, caustics, shafts
  // above the water: the evening sun, low over the sea ahead, and the sky's own light
  skySunDir: uniform(new Vector3(0.12, 0.1, -1).normalize()),
  skySunCol: uniform(new Color(2.1, 1.35, 0.85)),
  skyLow: uniform(new Color(1.0, 0.66, 0.48)),                     // the sky at the horizon
  skyHigh: uniform(new Color(0.42, 0.52, 0.86)),                   // and overhead
  shadowMat: uniform(new Matrix4()),
  shadowTexel: uniform(new Vector2(1 / 4096, 1 / 2048)),
  lampPos: uniform(new Vector3(0, -1000, 0)),
  lampDir: uniform(new Vector3(0, 0, -1)),
  lampCol: uniform(new Vector4(0, 0, 0, 0.86)),                   // rgb, and the cosine of the cone's edge
  glowPos: uniformArray([0, 1, 2, 3].map(() => new Vector4(0, -1000, 0, 1)), 'vec4'),   // xyz, reach
  glowCol: uniformArray([0, 1, 2, 3].map(() => new Vector4(0, 0, 0, 0)), 'vec4'),       // rgb
  // the textures the page draws itself; the engine sets them before any material is made
  waterTex: null,      // r: caustics, ba: the surface's slope
  detailTex: null,     // rg: slope, b: height, a: mottle
  stitchTex: null,     // rg: slope, b: height of the yarn, a: which stitch (0..1); 8 by 8 stitches
  shadowTex: null,
  debug: 0,            // 1: show only shadow times caustics (dev.html?dbg)
};

// (clear, bright water, as in the pictures of the dive: colours carry; the deep still goes
// black because below the ledge depth counts for more)
export const SIG = vec3(0.034, 0.0150, 0.0125);   // what a metre of water takes from a line of sight
export const KD = vec3(0.026, 0.0118, 0.0088);    // what a metre of depth takes from the light coming down

// ---- noise, for the textures drawn at load ---------------------------------------------

// One round of multiply and xor-shift on the three coordinates: enough to look random.
export const hash3 = Fn(([p]) => {
  const n = uint(p.x).mul(uint(1597334677)).bitXor(uint(p.y).mul(uint(3812015801))).bitXor(uint(p.z).mul(uint(2798796415))).toVar();
  n.assign(n.bitXor(n.shiftRight(uint(15))).mul(uint(2246822519)));
  n.assign(n.bitXor(n.shiftRight(uint(13))));
  return float(n.shiftRight(uint(8))).mul(1 / 16777216);
}, { p: 'ivec3', return: 'float' });
export const hash1 = Fn(([x]) => hash3(ivec3(int(floor(x.mul(8191))), int(17), int(3))), { x: 'float', return: 'float' });
// Value noise, 0..1, that repeats every `per` units, for textures that tile.
export const vnoiseP = Fn(([x, per]) => {
  const i = floor(x);
  const f = x.sub(i).toVar();
  f.assign(f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)));
  const p = ivec3(i).mod(per).add(per).mod(per).toVar();
  const q = p.add(ivec3(1, 1, 1)).mod(per).toVar();
  const a = mix(hash3(ivec3(p.x, p.y, p.z)), hash3(ivec3(q.x, p.y, p.z)), f.x);
  const b = mix(hash3(ivec3(p.x, q.y, p.z)), hash3(ivec3(q.x, q.y, p.z)), f.x);
  const c = mix(hash3(ivec3(p.x, p.y, q.z)), hash3(ivec3(q.x, p.y, q.z)), f.x);
  const d = mix(hash3(ivec3(p.x, q.y, q.z)), hash3(ivec3(q.x, q.y, q.z)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}, { x: 'vec3', per: 'int', return: 'float' });

// ---- the water --------------------------------------------------------------------------

// How deep a height counts as, for light: metres as drawn down to the ledge, more below it.
export const optDepth = Fn(([y]) => {
  const d = max(y.negate(), 0.0);
  const e = d.sub(G.opt.z);
  return d.add(G.opt.w.mul(0.5).mul(sqrt(e.mul(e).add(144.0)).add(e)));
});
// The sun at a height, after the slanted way down through the water.
export const sunAt = Fn(([y]) => G.sunCol.mul(exp(KD.mul(optDepth(y).div(G.sunDir.y)).negate())).mul(G.light.x));
// The light of the whole sky on a surface facing n: strongest from above, never quite nothing.
export const skyAt = Fn(([w, n]) => {
  const up = n.y.mul(0.5).add(0.5);
  const down = exp(KD.mul(optDepth(w.y)).negate()).toVar();
  return G.amb.mul(pow(down, vec3(1.15))).mul(up.mul(up).mul(0.74).add(0.26)).mul(1.25)
    .add(G.scat.mul(down).mul(float(1).sub(abs(n.y))).mul(0.42)).mul(G.light.y);
});
// The light the water scatters toward the eye along a ray of length d that starts where
// the optical depth is od and changes at the rate slope per metre down. (The sum of the
// light coming down at each point of the ray, times what the water lets through from
// there: it has a closed form because both fall off exponentially.)
export const scatterFrom = Fn(([od, slope, rd, d]) => {
  // (below the ledge depth counts for more; a ray that climbs or falls steeply through it
  // crosses more water than its length, so its own extinction stretches the same way)
  const a0 = SIG.mul(slope.sub(1.0).mul(abs(rd.y)).add(1.0)).sub(KD.mul(slope.mul(rd.y)));
  const a = max(abs(a0), vec3(1e-4)).mul(sign(sign(a0).add(0.5))).toVar();
  const I = float(1).sub(exp(clamp(a.negate().mul(d), vec3(-40), vec3(7)))).div(a);
  const mu = max(dot(rd, G.sunDir), 0.0);
  const mu2 = mu.mul(mu);
  return G.scat.mul(SIG).mul(exp(KD.mul(od).negate())).mul(I).mul(mu2.mul(mu2).mul(0.32).add(1.2)).mul(G.light.y);
});
// The same, from the eye.
export const scatter = Fn(([rd, d]) => scatterFrom(G.opt.x, G.opt.y, rd, d));
// The evening sky in a direction: peach at the horizon, blue overhead, the sun's glow.
export const skyColor = Fn(([rd]) => {
  const up = max(rd.y, 0.0);
  const base = mix(G.skyLow, G.skyHigh, pow(up, 0.55));
  const sd = max(dot(rd, G.skySunDir), 0.0);
  return base.add(G.skySunCol.mul(pow(sd, 6.0).mul(0.35).add(pow(sd, 64.0).mul(1.2)).add(pow(sd, 900.0).mul(14.0))));
});
// A colour seen from the eye: through the water for the part of the way that is under the
// surface, through the evening air for the part above it. (The eye sits at the waterline
// at the start and the end of the dive, so one line of sight can be in either.)
export const inWater = Fn(([col, w]) => {
  const v = w.sub(cameraPosition);
  const d = length(v);
  const rd = v.div(d).toVar();
  const cy = cameraPosition.y, wy = w.y;
  const den = cy.sub(wy);
  const cross = clamp(cy.div(select(abs(den).lessThan(1e-4), float(1e-4), den)), 0.0, 1.0);
  // how much of the way is under water
  const under = select(cy.lessThan(0.0), select(wy.lessThan(0.0), float(1.0), cross), select(wy.lessThan(0.0), float(1.0).sub(cross), float(0.0))).toVar();
  const dw = d.mul(under);
  const fromEye = cy.lessThan(0.0);
  const wet = col.mul(exp(SIG.mul(dw).negate())).add(scatterFrom(select(fromEye, G.opt.x, float(0.0)), select(fromEye, G.opt.y, float(1.0)), rd, dw));
  // the air: a light haze toward the horizon's colour, far off
  return mix(wet, skyColor(rd), float(1.0).sub(exp(d.mul(float(1.0).sub(under)).mul(-0.0025))));
});
// Where a point's sunlight came through the surface.
export const sunFoot = Fn(([w]) => w.xz.sub(G.sunDir.xz.mul(w.y.div(G.sunDir.y))));
// Caustics on a point: two sizes of the same net, crossing, so it never repeats. About 1/3
// on average. The deeper the point, the more the net has spread: it is read from a blurrier
// level of the texture, so it softens into a dapple and then into even light.
export const caustic = Fn(([w, dist]) => {
  const q = sunFoot(w);
  const lod = min(w.y.negate().mul(0.16), 6.0);
  const a = texture(G.waterTex, q.div(4.3)).bias(lod).r;
  const b = texture(G.waterTex, q.yx.div(9.1).add(0.37)).bias(lod).r;
  const c = min(a.mul(b.mul(1.5).add(0.5)), 1.6);
  return mix(c, 0.33, smoothstep(30.0, 90.0, dist));
});
// The sun's shadow at a point: 1 in the light. Outside the map, and below the ledge, there
// is none. (The map is read whatever happens and the answer chosen after, because WebGPU
// only allows this kind of read where every pixel takes the same path.)
const shadowAt = (w) => G.shadowMat.mul(vec4(w, 1.0)).xyz;
const outsideMap = (s) => s.x.lessThan(0.0).or(s.x.greaterThan(1.0)).or(s.y.lessThan(0.0)).or(s.y.greaterThan(1.0)).or(s.z.greaterThan(1.0));
export const shadow1 = Fn(([w]) => {
  const s = shadowAt(w).toVar();
  const v = texture(G.shadowTex, clamp(s.xy, 0.0, 1.0)).compare(s.z.sub(0.0005));
  return select(outsideMap(s), float(1.0), v);
});
export const shadow4 = Fn(([w]) => {
  const s = shadowAt(w).toVar();
  const t = G.shadowTexel.mul(1.6);
  const uv = clamp(s.xy, 0.0, 1.0).toVar(), z = s.z.sub(0.0005);
  const v = texture(G.shadowTex, uv.add(t.mul(vec2(-0.5, -1.0)))).compare(z)
    .add(texture(G.shadowTex, uv.add(t.mul(vec2(1.0, -0.5)))).compare(z))
    .add(texture(G.shadowTex, uv.add(t.mul(vec2(0.5, 1.0)))).compare(z))
    .add(texture(G.shadowTex, uv.add(t.mul(vec2(-1.0, 0.5)))).compare(z)).mul(0.25);
  return select(outsideMap(s), float(1.0), v);
});

// The detail texture, read along the three axes and blended by which way the surface
// faces, so it wraps anything without seams. Returns the bent normal, the height and the
// mottle. k is how strongly the normal bends.
export function detail(p, n, scale, k) {
  const w0 = pow(abs(n), vec3(4.0));
  const w = w0.div(w0.x.add(w0.y).add(w0.z)).toVar();
  const x = texture(G.detailTex, p.zy.mul(scale)).toVar();
  const y = texture(G.detailTex, p.xz.mul(scale)).toVar();
  const z = texture(G.detailTex, p.xy.mul(scale)).toVar();
  const hm = x.ba.mul(w.x).add(y.ba.mul(w.y)).add(z.ba.mul(w.z)).toVar();
  const gx = x.rg.sub(0.5).mul(k), gy = y.rg.sub(0.5).mul(k), gz = z.rg.sub(0.5).mul(k);
  const b = vec3(0.0, gx.y, gx.x).mul(w.x).add(vec3(gy.x, 0.0, gy.y).mul(w.y)).add(vec3(gz.x, gz.y, 0.0).mul(w.z));
  return { n: normalize(n.sub(b)).toVar(), h: hm.x, m: hm.y };
}

// (These are written out where they are used, not compiled as functions of their own: a
// function of its own would not see the shared values above.)

// ---- yarn ---------------------------------------------------------------------------------

// Crochet: lay the stitch texture on a surface and make it wool. Call it from a surface step:
//   yarn(s, f, { color, color2, stripe, scale, p, k, fuzz })
//     color    the yarn's colour (vec3)
//     color2   a second colour for stripes (rows of `stripe` stitches each, counted up p.y);
//              leave it out for one colour
//     scale    stitches per metre (default 20: chunky, readable from a few metres)
//     p        where to read the stitches: default f.obj (the shape's own space, so they stay
//              on a moving shape); pass f.w for things that never move
//     k        how strongly the stitches bend the light (default 1.3)
//     fuzz     how much the wool glows at grazing angles (default 1)
// The stitches are laid along the three axes and blended by which way the surface faces, so
// any shape takes them without seams; rows run level on upright faces.
export function yarn(s, f, o) {
  const p = (o.p ?? f.obj).mul((o.scale ?? 20) / 8).toVar();
  const n = s.n;
  const w0 = pow(abs(n), vec3(4.0));
  const w = w0.div(w0.x.add(w0.y).add(w0.z)).toVar();
  const x = texture(G.stitchTex, p.zy).toVar(), y = texture(G.stitchTex, p.xz).toVar(), z = texture(G.stitchTex, p.xy).toVar();
  const h = x.b.mul(w.x).add(y.b.mul(w.y)).add(z.b.mul(w.z)).toVar();
  const id = x.a.mul(w.x).add(y.a.mul(w.y)).add(z.a.mul(w.z));
  const k = o.k ?? 1.3;
  const gx = x.rg.sub(0.5).mul(k), gy = y.rg.sub(0.5).mul(k), gz = z.rg.sub(0.5).mul(k);
  const b = vec3(0.0, gx.y, gx.x).mul(w.x).add(vec3(gy.x, 0.0, gy.y).mul(w.y)).add(vec3(gz.x, gz.y, 0.0).mul(w.z));
  s.n = normalize(n.sub(b)).toVar();
  // the colour: stripes by row, a little difference from stitch to stitch, darker in the gaps
  let col = o.color;
  if (o.color2) {
    const band = floorN(p.y.mul(8).div(o.stripe ?? 3));
    col = mix(o.color, o.color2, band.mul(0.5).fract().mul(2.0).floor());
  }
  s.albedo = vec3(col).mul(h.mul(0.5).add(0.5)).mul(id.mul(0.16).add(0.92));
  s.ao = s.ao.mul(h.mul(0.35).add(0.65));
  s.spec = float(0.03); s.gloss = float(9.0); s.trans = float(0.18); s.fluor = float(0.55);
  // wool catches the light at grazing angles: a soft halo on every outline
  const vv = normalize(cameraPosition.sub(f.w));
  const graze = pow(float(1.0).sub(abs(dot(s.n, vv))), 3.0);
  s.emis = s.emis.add(sunAt(f.w.y).mul(0.06).add(G.amb.mul(0.14)).mul(graze).mul(s.albedo).mul(o.fuzz ?? 1.0));
  return { h, id };
}

// ---- light ------------------------------------------------------------------------------

// Everything that lights a surface, in the water: the sun (through its shadow, with the
// caustics), the sky, light that comes through thin things from behind, warm colours
// answering blue light, a highlight, the visitor's lamp, and the four glows.
export const shadeLit = Fn(([albedo, n, spec, gloss, trans, fluor, emis, ao, sh, w]) => {
  const toEye = cameraPosition.sub(w);
  const dist = length(toEye);
  const v = toEye.div(dist);
  // above the water: the evening sun and sky, no shadow map, no caustics
  const air = smoothstep(-0.02, 0.06, w.y).toVar();
  const sunL = normalize(mix(G.sunDir, G.skySunDir, air)).toVar();
  const E = mix(sunAt(w.y).mul(sh), G.skySunCol.mul(0.8), air).toVar();
  const ndl = dot(n, sunL).toVar();
  const ca = mix(mix(float(0.33), caustic(w, dist).mul(G.light.z).add(G.light.z.oneMinus().mul(0.33)), smoothstep(-0.1, 0.4, ndl)), float(0.33), air).toVar();
  const direct = E.mul(ca.mul(2.6).add(0.10)).mul(max(ndl, 0.0).add(trans.mul(max(ndl.negate(), 0.0).mul(0.85).add(0.15))));
  const amb = mix(skyAt(w, n), mix(G.skyLow, G.skyHigh, n.y.mul(0.5).add(0.5)).mul(0.55), air).mul(ao).add(trans.mul(skyAt(w, n.negate())).mul(ao).mul(0.5));
  const light = direct.add(amb).toVar();
  const col = albedo.mul(light).toVar();
  // warm colours answer the blue-green light they stand in, so they stay warm under water
  col.addAssign(albedo.mul(fluor).mul(dot(light, vec3(0.1, 0.5, 0.5))));
  const h = normalize(v.add(sunL));
  col.addAssign(E.mul(ca.add(0.25)).mul(spec).mul(pow(max(dot(n, h), 0.0), gloss)).mul(max(ndl, 0.0)).mul(1.6));
  // the lamp: a cone of light the visitor steers, in the dark
  const toL0 = G.lampPos.sub(w);
  const dl = length(toL0);
  const toL = toL0.div(dl).toVar();
  const cone = smoothstep(G.lampCol.w, mix(G.lampCol.w, 1.0, 0.75), dot(toL.negate(), G.lampDir));
  const lamp = G.lampCol.rgb.mul(cone).mul(exp(SIG.mul(dl).negate())).div(dl.mul(dl).mul(0.012).add(1.0)).toVar();
  const nl = max(dot(n, toL).add(0.25).div(1.25), 0.0);
  col.addAssign(albedo.mul(lamp).mul(nl.add(trans.mul(0.5))).mul(ao.mul(0.5).add(0.5)).mul(fluor.add(1.0)));
  col.addAssign(lamp.mul(spec).mul(pow(max(dot(n, normalize(v.add(toL))), 0.0), gloss)));
  // the glows: the vents, the geode, the wreck's lantern
  Loop(4, ({ i }) => {
    const gp = G.glowPos.element(i);
    const g = gp.xyz.sub(w);
    const dg = length(g);
    const f = max(float(1.0).sub(dg.div(gp.w)), 0.0);
    col.addAssign(albedo.mul(G.glowCol.element(i).rgb).mul(f.mul(f)).mul(max(dot(n, g.div(dg)).add(0.4).div(1.4), 0.0)).mul(ao.mul(0.5).add(0.5)).mul(fluor.add(1.0)));
  });
  return col.add(emis);
});

// ---- materials --------------------------------------------------------------------------

// What the vertex step hands the surface step.
export const vAux = varyingProperty('vec4', 'v_aux');
export const vNrm = varyingProperty('vec3', 'v_nrm');
export const vPos = varyingProperty('vec3', 'v_pos');
export const vObj = varyingProperty('vec3', 'v_obj');     // the shape's own position, before anything moves it

// Instances carry their own placement: three rows of a 3x4 matrix (rotation and scale,
// then the move) in the attributes i0, i1, i2. (Not three.js's InstancedMesh: this way
// the vertex step sees the placed shape and can bend it in the world.)
const placeP = (P) => vec3(dot(attribute('i0', 'vec4').xyz, P).add(attribute('i0', 'vec4').w), dot(attribute('i1', 'vec4').xyz, P).add(attribute('i1', 'vec4').w), dot(attribute('i2', 'vec4').xyz, P).add(attribute('i2', 'vec4').w));
const placeN = (N) => normalize(vec3(dot(attribute('i0', 'vec4').xyz, N), dot(attribute('i1', 'vec4').xyz, N), dot(attribute('i2', 'vec4').xyz, N)));

// Build a material.
//   vertex(v)      may change v.P and v.N (in the object's space; for `instanced`, already
//                  placed) and v.aux; runs per vertex
//   surface(s, f)  sets what the surface is: s.albedo, s.n, s.spec, s.gloss, s.trans,
//                  s.fluor, s.emis, s.ao, s.alpha, and s.shade if it looked up the shadow
//                  itself. f holds w (where it is), n (the vertex normal, facing the eye
//                  for twoSided), aux and dist.
//   raw(f)         instead of a lit surface, the colour itself (vec3)
// Options: aux (the geometry has an `aux` attribute), instanced, twoSided, side,
// transparent, additive, depthWrite, depthTest, shadow (false: casts none), and fade:
// [near, far] in metres, over which the surface melts into the open water behind it, so it
// is gone before the world stops drawing it (give add() a range of at least far).
export function material(o) {
  const m = new NodeMaterial();
  m.lights = false;
  m.fog = false;
  m.side = o.twoSided ? DoubleSide : (o.side ?? FrontSide);
  const blended = !!(o.transparent || o.additive);
  m.transparent = blended;
  m.depthWrite = o.depthWrite ?? !blended;
  m.depthTest = o.depthTest ?? true;
  if (blended) {
    // the colour blends; the distance in alpha is left as the solid things wrote it
    m.blending = CustomBlending;
    m.blendEquation = AddEquation;
    m.blendSrc = SrcAlphaFactor;
    m.blendDst = o.additive ? OneFactor : OneMinusSrcAlphaFactor;
    m.blendEquationAlpha = AddEquation;
    m.blendSrcAlpha = ZeroFactor;
    m.blendDstAlpha = OneFactor;
  }
  // (built twice: v.shadow is true for the shadow map's twin, where the camera is the sun)
  const position = (shadow) => Fn(() => {
    const P = (o.instanced ? placeP(positionLocal) : positionLocal).toVar('P');
    const N = (o.instanced ? placeN(normalLocal) : normalLocal).toVar('N');
    const aux = (o.aux ? attribute('aux', 'vec4') : vec4(0.0)).toVar('A');
    const v = { P, N, aux, shadow };
    if (o.vertex) o.vertex(v);
    if (!shadow) {
      vObj.assign(positionGeometry);
      vAux.assign(v.aux);
      vNrm.assign(normalize(modelWorldMatrix.mul(vec4(v.N, 0.0)).xyz));
      vPos.assign(modelWorldMatrix.mul(vec4(v.P, 1.0)).xyz);
    }
    return v.P;
  })();
  m.positionNode = position(false);
  m.fragmentNode = Fn(() => {
    const w = vPos.toVar('W');
    const dist = length(w.sub(cameraPosition));
    const n0 = normalize(vNrm).toVar('N0');
    const f = { w, n: o.twoSided ? n0.mul(faceDirection).toVar() : n0, aux: vAux, dist, obj: vObj };
    let col, alpha;
    if (o.raw) {
      // a colour (solid), or { color, alpha } (blended)
      const r = o.raw(f);
      col = r.color ?? r;
      alpha = r.alpha ?? float(1.0);
    } else {
      const s = { albedo: vec3(0.5), n: f.n, spec: float(0.0), gloss: float(24.0), trans: float(0.0), fluor: float(0.0), emis: vec3(0.0), ao: float(1.0), alpha: float(1.0), shade: null };
      o.surface?.(s, f);
      const sh = s.shade ?? shadow4(w.add(s.n.mul(0.14)).add(G.sunDir.mul(0.05)));
      col = min(inWater(shadeLit(s.albedo, s.n, s.spec, s.gloss, s.trans, s.fluor, s.emis, s.ao, sh, w), w), vec3(40.0));
      alpha = s.alpha;
      if (G.debug) col = vec3(shadow4(w.add(s.n.mul(0.14)).add(G.sunDir.mul(0.05)))).mul(caustic(w, float(1.0)).add(0.2));
    }
    if (o.fade) col = mix(col, scatter(w.sub(cameraPosition).div(dist), float(300.0)), smoothstep(o.fade[0], o.fade[1], dist));
    return vec4(col, blended ? alpha : dist);
  })();
  // the twin for the shadow map: the same shape, depth only
  if (o.shadow !== false && !o.raw && !blended) {
    const d = new NodeMaterial();
    d.lights = false;
    d.fog = false;
    d.side = DoubleSide;
    d.colorWrite = false;
    d.positionNode = position(true);
    d.fragmentNode = vec4(0.0);
    m.userData.depth = d;
  }
  return m;
}

// Raw materials for quads: a fragment step and nothing else.
export function pass(fragment) {
  const m = new NodeMaterial();
  m.lights = false;
  m.fog = false;
  m.depthTest = false;
  m.depthWrite = false;
  m.fragmentNode = fragment;
  return m;
}

export { BackSide };
