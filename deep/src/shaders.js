// The look. Every material in the dive is assembled here from the same pieces, so
// everything is lit by the same sun, sits in the same water, and fades the same way.
//
//   G            the uniforms all materials share (time, sun, water, shadow, lamp, glows)
//   material()   builds a ShaderMaterial from a vertex snippet and a surface snippet,
//                and a twin that only writes depth, for the shadow map
//   WATER        the GLSL every snippet can call
//
// The water model, in one place:
//   - Light comes down from the surface and the water takes it out as it goes, red first
//     (KD, per metre of depth). Below the ledge the dive is deeper than it is drawn, so
//     depth counts for more there (optical depth, uOpt).
//   - Along a line of sight the water takes light out again (SIG) and scatters some of
//     the light coming down into the eye. That sum has a closed form (scatter), and it is
//     why looking up is bright, looking down is dark, far is blue and deep is black,
//     with no colour ramp anywhere.
//   - The sun also throws shadows (one map, drawn once) and caustics (one small texture,
//     drawn every frame), both along the same slanted ray, so they agree with the shafts.
//   - Deep down the only light is the lamp and what glows by itself.
import { AdditiveBlending, Color, DoubleSide, FrontSide, Matrix4, ShaderMaterial, Vector3, Vector4 } from 'three';
import { SUN } from './layout.js';

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(-SUN[0], -SUN[1], -SUN[2]) },      // toward the sun
  uSunCol: { value: new Color(1.7, 1.6, 1.42) },
  uScat: { value: new Color(0.16, 0.58, 0.9) },                    // the colour the water scatters, at the camera
  uAmb: { value: new Color(0.22, 0.6, 0.8) },                      // the colour of the light from above
  uOpt: { value: new Vector4(0, 1, 60, 3.2) },                     // optical depth at the camera, its slope there, the knee, the slope below it
  uLight: { value: new Vector4(1, 1, 1, 1) },                      // scales: sun, sky, caustics, shafts
  tWater: { value: null },                                         // r: caustics, ba: the surface's slope
  tDetail: { value: null },                                        // rg: slope, b: height, a: mottle
  tShadow: { value: null },
  uShadowMat: { value: new Matrix4() },
  uLampPos: { value: new Vector3(0, -1000, 0) },
  uLampDir: { value: new Vector3(0, 0, -1) },
  uLampCol: { value: new Vector4(0, 0, 0, 0.86) },                 // rgb, and the cosine of the cone's edge
  uGlowPos: { value: [new Vector4(0, -1000, 0, 1), new Vector4(0, -1000, 0, 1), new Vector4(0, -1000, 0, 1), new Vector4(0, -1000, 0, 1)] },  // xyz, reach
  uGlowCol: { value: [new Color(0, 0, 0), new Color(0, 0, 0), new Color(0, 0, 0), new Color(0, 0, 0)] },
};

export const NOISE = /* glsl */ `
// One round of multiply and xor-shift on the three coordinates: enough to look random.
float hash3(ivec3 p) {
  uint n = uint(p.x) * 1597334677u ^ uint(p.y) * 3812015801u ^ uint(p.z) * 2798796415u;
  n = (n ^ (n >> 15u)) * 2246822519u;
  n ^= n >> 13u;
  return float(n >> 8u) * (1.0 / 16777216.0);
}
float hash1(float x) { return hash3(ivec3(int(floor(x * 8191.0)), 17, 3)); }
// Value noise, 0..1. With a period it repeats every per units, for textures that tile.
float vnoiseP(vec3 x, int per) {
  vec3 i = floor(x), f = x - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 p = ivec3(i), q = p + 1;
  if (per > 0) { p = ((p % per) + per) % per; q = ((q % per) + per) % per; }
  float a = mix(hash3(ivec3(p.x, p.y, p.z)), hash3(ivec3(q.x, p.y, p.z)), f.x);
  float b = mix(hash3(ivec3(p.x, q.y, p.z)), hash3(ivec3(q.x, q.y, p.z)), f.x);
  float c = mix(hash3(ivec3(p.x, p.y, q.z)), hash3(ivec3(q.x, p.y, q.z)), f.x);
  float d = mix(hash3(ivec3(p.x, q.y, q.z)), hash3(ivec3(q.x, q.y, q.z)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
float vnoise(vec3 x) { return vnoiseP(x, 0); }
float fbm(vec3 x) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(x); x = x * 2.03 + vec3(17.1, 9.2, 3.7); a *= 0.5; }
  return s / 0.875;
}
`;

export const WATER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uScat;
uniform vec3 uAmb;
uniform vec4 uOpt;
uniform vec4 uLight;
uniform sampler2D tWater;
uniform sampler2D tDetail;
uniform highp sampler2DShadow tShadow;
uniform mat4 uShadowMat;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform vec4 uLampCol;
uniform vec4 uGlowPos[4];
uniform vec3 uGlowCol[4];

const vec3 SIG = vec3(0.060, 0.0245, 0.0200);   // what a metre of water takes from a line of sight
const vec3 KD = vec3(0.058, 0.0250, 0.0175);    // what a metre of depth takes from the light coming down

// How deep a height counts as, for light: metres as drawn down to the ledge, more below it.
float optDepth(float y) { float d = max(-y, 0.0), e = d - uOpt.z; return d + uOpt.w * 0.5 * (sqrt(e * e + 144.0) + e); }
// The sun at a height, after the slanted way down through the water.
vec3 sunAt(float y) { return uSunCol * exp(-KD * (optDepth(y) / uSunDir.y)) * uLight.x; }
// The light of the whole sky on a surface facing n: strongest from above, never quite nothing.
vec3 skyAt(vec3 w, vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec3 down = exp(-KD * optDepth(w.y));
  return (uAmb * pow(down, vec3(1.15)) * (0.26 + 0.74 * up * up) * 1.25 + uScat * down * (1.0 - abs(n.y)) * 0.42) * uLight.y;
}
// The light the water scatters toward the eye along a ray of length d that starts where
// the optical depth is od and changes at the rate slope per metre down. (The sum of the
// light coming down at each point of the ray, times what the water lets through from
// there: it has a closed form because both fall off exponentially.)
vec3 scatterFrom(float od, float slope, vec3 rd, float d) {
  vec3 a = SIG - KD * (slope * rd.y);
  a = sign(a) * max(abs(a), vec3(1e-4));
  vec3 I = (1.0 - exp(clamp(-a * d, vec3(-40.0), vec3(7.0)))) / a;
  float mu = max(dot(rd, uSunDir), 0.0); mu *= mu;
  return uScat * SIG * exp(-KD * od) * I * (1.2 + 0.32 * mu * mu) * uLight.y;
}
// The same, from the eye.
vec3 scatter(vec3 rd, float d) { return scatterFrom(uOpt.x, uOpt.y, rd, d); }
// A colour seen through the water between it and the eye.
vec3 inWater(vec3 col, vec3 w) {
  vec3 v = w - cameraPosition;
  float d = length(v);
  return col * exp(-SIG * d) + scatter(v / d, d);
}
// Where a point's sunlight came through the surface.
vec2 sunFoot(vec3 w) { return w.xz - uSunDir.xz * (w.y / uSunDir.y); }
// Caustics on a point: two sizes of the same net, crossing, so it never repeats. About 1/3
// on average. The deeper the point, the more the net has spread: it is read from a blurrier
// level of the texture, so it softens into a dapple and then into even light.
float caustic(vec3 w, float dist) {
  vec2 q = sunFoot(w);
  float blur = min(-w.y * 0.16, 6.0);
  float a = texture2D(tWater, q / 4.3, blur).r, b = texture2D(tWater, q.yx / 9.1 + 0.37, blur).r;
  float c = min(a * (0.5 + 1.5 * b), 1.6);
  return mix(c, 0.33, smoothstep(30.0, 90.0, dist));
}
// The sun's shadow at a point: 1 in the light. Outside the map, and below the ledge, there is none.
float shadow1(vec3 w) {
  vec4 s = uShadowMat * vec4(w, 1.0);
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  return texture(tShadow, vec3(s.xy, s.z - 0.0005));
}
float shadow4(vec3 w) {
  vec4 s = uShadowMat * vec4(w, 1.0);
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  vec2 t = 1.6 / vec2(textureSize(tShadow, 0));
  float z = s.z - 0.0005;
  return 0.25 * (texture(tShadow, vec3(s.xy + t * vec2(-0.5, -1.0), z)) + texture(tShadow, vec3(s.xy + t * vec2(1.0, -0.5), z)) + texture(tShadow, vec3(s.xy + t * vec2(0.5, 1.0), z)) + texture(tShadow, vec3(s.xy + t * vec2(-1.0, 0.5), z)));
}

// The detail texture, read along the three axes and blended by which way the surface
// faces, so it wraps anything without seams. Returns the bent normal, and height and
// mottle in hm. k is how strongly the normal bends.
vec3 detail(vec3 p, vec3 n, float scale, float k, out vec2 hm) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= w.x + w.y + w.z;
  vec4 x = texture2D(tDetail, p.zy * scale), y = texture2D(tDetail, p.xz * scale), z = texture2D(tDetail, p.xy * scale);
  hm = x.ba * w.x + y.ba * w.y + z.ba * w.z;
  vec2 gx = (x.rg - 0.5) * k, gy = (y.rg - 0.5) * k, gz = (z.rg - 0.5) * k;
  vec3 b = vec3(0.0, gx.y, gx.x) * w.x + vec3(gy.x, 0.0, gy.y) * w.y + vec3(gz.x, gz.y, 0.0) * w.z;
  return normalize(n - b);
}

struct Surf {
  vec3 albedo;
  vec3 n;
  float spec;     // how bright the highlight is
  float gloss;    // how tight
  float trans;    // light that comes through from behind (leaves, fins, wool)
  float fluor;    // how much it answers blue light with its own colour (corals, Snap)
  vec3 emis;      // light of its own
  float ao;       // how open to the light it is here
  float alpha;
  float shade;    // the sun's shadow here, if the snippet already looked it up (< 0: not yet)
};
vec3 shade(Surf s, vec3 w) {
  vec3 n = s.n;
  vec3 toEye = cameraPosition - w;
  float dist = length(toEye);
  vec3 v = toEye / dist;
  float sh = s.shade < 0.0 ? shadow4(w + n * 0.14 + uSunDir * 0.05) : s.shade;
  vec3 E = sunAt(w.y) * sh;
  float ndl = dot(n, uSunDir);
  float ca = mix(0.33, caustic(w, dist) * uLight.z + 0.33 * (1.0 - uLight.z), smoothstep(-0.1, 0.4, ndl));
  vec3 direct = E * (0.10 + ca * 2.6) * (max(ndl, 0.0) + s.trans * (max(-ndl, 0.0) * 0.85 + 0.15));
  vec3 amb = skyAt(w, n) * s.ao + s.trans * skyAt(w, -n) * s.ao * 0.5;
  vec3 light = direct + amb;
  vec3 col = s.albedo * light;
  // warm colours answer the blue-green light they stand in, so they stay warm under water
  col += s.albedo * s.fluor * dot(light, vec3(0.1, 0.5, 0.5));
  vec3 h = normalize(v + uSunDir);
  col += E * (0.25 + ca) * s.spec * pow(max(dot(n, h), 0.0), s.gloss) * max(ndl, 0.0) * 1.6;
  // the lamp: a cone of light the visitor steers, in the dark
  vec3 toL = uLampPos - w; float dl = length(toL); toL /= dl;
  float cone = smoothstep(uLampCol.w, mix(uLampCol.w, 1.0, 0.45), dot(-toL, uLampDir));
  vec3 lamp = uLampCol.rgb * cone * exp(-SIG * dl) / (1.0 + 0.012 * dl * dl);
  float nl = max((dot(n, toL) + 0.25) / 1.25, 0.0);
  col += s.albedo * lamp * (nl + s.trans * 0.5) * (0.5 + 0.5 * s.ao) * (1.0 + s.fluor);
  col += lamp * s.spec * pow(max(dot(n, normalize(v + toL)), 0.0), s.gloss);
  // the glows: the vents, the geode, the wreck's lantern
  for (int i = 0; i < 4; i++) {
    vec3 g = uGlowPos[i].xyz - w; float dg = length(g);
    float f = max(1.0 - dg / uGlowPos[i].w, 0.0);
    col += s.albedo * uGlowCol[i] * f * f * max((dot(n, g / dg) + 0.4) / 1.4, 0.0) * (0.5 + 0.5 * s.ao) * (1.0 + s.fluor);
  }
  return col + s.emis;
}
`;

const VERT_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vAux;
`;
const FRAG_HEAD = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vAux;
`;

// Build a material. The vertex snippet (`vertMain`) may move P and turn N, both in the
// object's space, and may set vAux; the surface snippet (`surf`) fills in `s`, a Surf.
// `vert` and `frag` hold extra declarations and functions. With `raw: true` the surface
// snippet writes gl_FragColor itself (the surface of the sea, particles, things that
// glow). Unless `shadow: false`, the material carries a twin in userData.depth that runs
// the same vertex snippet and writes only depth: what the shadow map is drawn with.
export function material(o) {
  const defines = { ...(o.defines || {}) };
  if (DEV && new URLSearchParams(location.search).has('dbg')) defines.DBG = 1;
  const uniforms = { ...G, ...(o.uniforms || {}) };
  const vertexShader = `${VERT_HEAD}${o.aux ? 'attribute vec4 aux;\n' : ''}${NOISE}${o.vert || ''}
void main() {
  vec3 P = position; vec3 N = normal; vUv = uv; vAux = ${o.aux ? 'aux' : 'vec4(0.0)'};
  ${o.vertMain || ''}
  #ifdef USE_INSTANCING
  mat4 M = modelMatrix * instanceMatrix;
  #else
  mat4 M = modelMatrix;
  #endif
  vec4 wp = M * vec4(P, 1.0);
  vW = wp.xyz; vN = mat3(M) * N;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${o.vertEnd || ''}
}`;
  const m = new ShaderMaterial({
    defines,
    uniforms,
    vertexShader,
    fragmentShader: `${FRAG_HEAD}${NOISE}${WATER}${o.frag || ''}
void main() {
  ${o.raw ? o.surf : `Surf s; s.albedo = vec3(0.5); s.n = normalize(vN); s.spec = 0.0; s.gloss = 24.0; s.trans = 0.0; s.fluor = 0.0; s.emis = vec3(0.0); s.ao = 1.0; s.alpha = 1.0; s.shade = -1.0;
  ${o.twoSided ? 's.n *= gl_FrontFacing ? 1.0 : -1.0;' : ''}
  ${o.surf || ''}
  gl_FragColor = vec4(min(inWater(shade(s, vW), vW), vec3(40.0)), s.alpha);
  #ifdef DBG
  gl_FragColor = vec4(vec3(shadow4(vW + s.n * 0.14 + uSunDir * 0.05)) * (0.2 + caustic(vW, 1.0)), 1.0);
  #endif`}
}`,
    side: o.twoSided ? DoubleSide : (o.side ?? FrontSide),
    transparent: !!o.transparent || !!o.additive,
    depthWrite: o.depthWrite ?? !(o.transparent || o.additive),
    depthTest: o.depthTest ?? true,
  });
  if (o.additive) m.blending = AdditiveBlending;
  if (o.shadow !== false && !o.raw && !o.transparent && !o.additive) {
    m.userData.depth = new ShaderMaterial({
      defines: { ...defines, SHADOW_PASS: 1 },
      uniforms,
      vertexShader,
      fragmentShader: 'void main() {}',
      side: DoubleSide,
    });
    m.userData.depth.colorWrite = false;
  }
  return m;
}

// ---- textures made by the page itself --------------------------------------------------

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// The water texture, drawn every frame: r is the brightness of the caustics, b and a the
// slope of the surface. The surface is a sum of ten waves whose crests fit the tile a
// whole number of times, so the texture repeats without a seam. Light through it gathers
// where it curves like a lens: the brightness on the sea floor is one over the determinant
// of how the surface bends the rays (I + s * Hessian), and bright lines form where that
// reaches zero.
export const WATER_TEX_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
const float TAU = 6.2831853;
void main() {
  vec2 p = vUv + 0.018 * vec2(sin(TAU * (vUv.y * 2.0 + 0.11 * uTime)), cos(TAU * (vUv.x * 3.0 - 0.08 * uTime)));
  float hxx = 0.0, hyy = 0.0, hxy = 0.0; vec2 slope = vec2(0.0);
  float th, s, sp;
  #define WAVE(kx, ky, w, ph) sp = (0.42 + 0.30 * sqrt(length(vec2(kx, ky)))) * ((kx + ky) > 0.0 ? 1.0 : -1.0); th = TAU * (kx * p.x + ky * p.y) + uTime * sp + ph; s = sin(th); hxx -= w * kx * kx * s; hyy -= w * ky * ky * s; hxy -= w * kx * ky * s; slope += w * vec2(kx, ky) * cos(th);
  WAVE(1.0, 2.0, 1.00, 0.0)
  WAVE(-2.0, 1.0, 0.90, 1.7)
  WAVE(3.0, 1.0, 0.62, 3.4)
  WAVE(1.0, -4.0, 0.50, 5.1)
  WAVE(4.0, 3.0, 0.40, 0.8)
  WAVE(-3.0, 5.0, 0.30, 2.5)
  WAVE(6.0, -2.0, 0.26, 4.2)
  WAVE(5.0, 7.0, 0.17, 5.9)
  WAVE(-8.0, 3.0, 0.15, 1.3)
  WAVE(2.0, 11.0, 0.10, 3.0)
  #undef WAVE
  const float S = 0.036;
  float det = (1.0 + S * hxx) * (1.0 + S * hyy) - S * S * hxy * hxy;
  float c = 0.085 / (0.085 + abs(det));
  gl_FragColor = vec4(c, c, slope * 0.06 * 0.5 + 0.5);
}
`;

// The detail texture, drawn once: rock, sand and wood all take their fine relief from it.
// It tiles. rg: the slope of the height, b: the height, a: a slower mottle for colour.
export const DETAIL_TEX_FRAG = /* glsl */ `
varying vec2 vUv;
float tf(vec2 uv, int per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0; float f = float(per);
  for (int i = 0; i < oct; i++) { s += a * vnoiseP(vec3(uv * f, float(i) * 3.7 + 1.3), per); n += a; f *= 2.0; per *= 2; a *= 0.5; }
  return s / n;
}
// The nearest of one random point per cell, repeating every per cells: x distance, y id.
vec2 tcell(vec2 x, int per) {
  ivec2 p = ivec2(floor(x)); vec2 f = fract(x);
  float best = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = ((p + ivec2(i, j)) % per + per) % per;
    vec2 o = vec2(hash3(ivec3(q, 5)), hash3(ivec3(q, 11)));
    vec2 r = vec2(i, j) + o - f;
    float d = dot(r, r);
    if (d < best) { best = d; id = hash3(ivec3(q, 23)); }
  }
  return vec2(sqrt(best), id);
}
float height(vec2 uv) {
  vec2 w = uv + 0.11 * (vec2(tf(uv, 3, 4), tf(uv + 0.5, 3, 4)) - 0.5);
  float f = tf(w, 3, 8);
  float ridge = 1.0 - abs(tf(w + 1.7, 5, 6) * 2.0 - 1.0);
  float crack = min(abs(tf(w + 4.1, 4, 5) * 2.0 - 1.0) * 7.0, 1.0) * min(abs(tf(w.yx + 2.3, 9, 4) * 2.0 - 1.0) * 9.0, 1.0);
  vec2 c = tcell(w * 29.0, 29);
  float pit = (1.0 - smoothstep(0.0, 0.34, c.x)) * step(0.62, c.y);
  return f * 0.50 + ridge * ridge * 0.24 + crack * 0.26 - pit * 0.07;
}
void main() {
  float e = 1.0 / 1024.0;
  float h = height(vUv);
  vec2 g = vec2(height(vUv + vec2(e, 0.0)) - height(vUv - vec2(e, 0.0)), height(vUv + vec2(0.0, e)) - height(vUv - vec2(0.0, e))) / (2.0 * e);
  gl_FragColor = vec4(clamp(g * 0.02 + 0.5, 0.0, 1.0), h, tf(vUv + 7.3, 4, 5));
}
`;

// ---- the passes that turn the drawn scene into the picture -----------------------------

// Light in the water itself, on half the pixels: the sun's shafts (where the shadow map
// lets them through, shaped by the same net as the caustics), the lamp's cone, and the
// haze around each glow. A few steps along each pixel's line of sight, as far as whatever
// was drawn there. rgb: the light, a: how far the scene is, for the pass that softens it.
export const SHAFT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
float interleaved(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float z = texture2D(tDepth, vUv).r;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vp /= vp.w;
  float far = length(vp.xyz);
  float dist = min(far, 110.0);
  vec3 dir = normalize((uCamWorld * vec4(normalize(vp.xyz), 0.0)).xyz);
  if (dir.y > 1e-4) dist = min(dist, -uCamPos.y / dir.y);     // nothing above the surface
  float jitter = interleaved(gl_FragCoord.xy);
  float dt = dist / float(STEPS);
  vec3 sun = vec3(0.0), other = vec3(0.0);
  float sunHere = uLight.w * step(1e-4, uLight.w);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jitter) * dt;
    vec3 w = uCamPos + dir * t;
    vec3 T = exp(-SIG * t);
    if (sunHere > 0.0) {
      vec2 q = sunFoot(w);
      float beam = smoothstep(0.26, 0.62, textureLod(tWater, q / 31.0, 2.6).r * 2.4) * smoothstep(0.12, 0.55, textureLod(tWater, q.yx / 13.0 + 0.3, 2.0).r * 2.4);
      sun += T * exp(-KD * (optDepth(w.y) / uSunDir.y)) * (shadow1(w) * (0.014 + 6.0 * beam));
    }
    vec3 toL = uLampPos - w; float dl = length(toL); toL /= dl;
    float cone = smoothstep(uLampCol.w, mix(uLampCol.w, 1.0, 0.45), dot(-toL, uLampDir));
    vec3 here = uLampCol.rgb * cone * exp(-SIG * dl) / (1.0 + 0.012 * dl * dl) * 0.045;
    for (int g = 0; g < 4; g++) {
      vec3 d = uGlowPos[g].xyz - w; float f = max(1.0 - length(d) / uGlowPos[g].w, 0.0);
      here += uGlowCol[g] * f * f * f * 0.028;
    }
    other += T * here;
  }
  float mu = max(dot(dir, uSunDir), 0.0);
  vec3 c = sun * dt * SIG * (uScat + vec3(0.04, 0.07, 0.05)) * uSunCol * (0.2 + 2.0 * mu * mu * mu) * sunHere * 0.55 + other * dt;
  gl_FragColor = vec4(min(c, vec3(20.0)), far);
}
`;
// Soften it: a three by three average that does not cross an edge in depth. (Each ray
// started at a different point along its length, in a pattern that such an average turns
// back into an even tone.)
export const SHAFT_BLUR = /* glsl */ `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {
  vec4 c0 = texture2D(tSrc, vUv);
  vec3 sum = vec3(0.0); float ws = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 c = texture2D(tSrc, vUv + uTexel * vec2(float(i), float(j)));
    float w = 1.0 / (0.03 + abs(c.a - c0.a) / max(c0.a, 0.1));
    sum += c.rgb * w; ws += w;
  }
  gl_FragColor = vec4(sum / ws, c0.a);
}
`;

// Bloom: halve and halve again, then add back up. Nothing is cut out first: what comes
// back is a wide soft veil over the whole picture, with the bright things widest.
export const BLOOM_DOWN = /* glsl */ `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
void main() {
  vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb, b = texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb, d = texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  if (uFirst > 0.5) {
    // (the first step weighs each sample down by its own brightness, so one white pixel cannot flicker the veil)
    a = min(a, vec3(24.0)); b = min(b, vec3(24.0)); c = min(c, vec3(24.0)); d = min(d, vec3(24.0));
    float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b))), wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b))), wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b))), wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
    gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
  } else gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
}
`;
export const BLOOM_UP = /* glsl */ `
varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.75, -0.75)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.75, -0.75)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-0.75, 0.75)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.75, 0.75)).rgb;
  gl_FragColor = vec4(c * 0.25 + texture2D(tAdd, vUv).rgb, 1.0);
}
`;

// The last pass: the scene, the light in the water, the veil; the chosen look; exposure
// and the curve that brings bright light into range; a little shaping of contrast; a
// vignette; and a grain finer than one step of brightness, so the long dark gradients do
// not show bands.
export const FINAL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tShaft;
uniform sampler2D tBloom;
uniform float uExposure;
uniform float uBloom;     // how many levels the veil was added up from
uniform vec4 uLook;       // x: which look (1 crisp, 2 deep sea, 3 vintage), y: how much
uniform float uFade;      // 1 is the picture, 0 is black
vec3 curve(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tShaft, vUv).rgb;
  vec3 bl = texture2D(tBloom, vUv).rgb / uBloom;
  c = mix(c, bl, 0.07) + bl * 0.035;
  c *= uExposure;
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.5;
  c = curve(c);
  float l0 = lum(c);
  float l = mix(l0, l0 * l0 * (3.0 - 2.0 * l0), 0.5);       // a gentle S on brightness
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3(l), smoothstep(0.6, 1.0, l) * 0.1);       // the brightest lose a little colour
  // the looks of the second choice, on the whole picture
  if (uLook.y > 0.0) {
    vec3 k = c;
    if (uLook.x < 1.5) { k = mix(vec3(l), c, 1.25); k = (k - 0.5) * 1.12 + 0.5; }
    else if (uLook.x < 2.5) { k = mix(vec3(0.051, 0.125, 0.180), vec3(1.0, 0.847, 0.541), smoothstep(0.02, 0.9, l)); }
    else { k = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))); k = mix(c, k, 0.86); }
    c = mix(c, clamp(k, 0.0, 1.0), uLook.y);
  }
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  c += (ign(gl_FragCoord.xy) + ign(gl_FragCoord.xy + 37.0) - 1.0) / 255.0;
  gl_FragColor = vec4(c * uFade, 1.0);
}
`;
