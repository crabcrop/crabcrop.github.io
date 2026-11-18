// The visitor's URL: its parts, how they are put together, and how it is signed or sealed.
// The words around it (option names, cards) are real markup in template.html; this file
// holds only what a script needs.
//
// Every URL the page shows is a real one. The signature is HMAC-SHA256 under the sample
// secret "demo-secret" over "<operations>/root:photos/print.jpg", in lowercase hex: the
// same thing the table in preview/home/home.js holds and `openssl dgst -sha256 -hmac
// demo-secret` prints, computed here because the dive has more combinations than that
// table. A sealed token is minted the way the SDKs mint one (spec/url-signing.md, "Sealed
// URLs"): AES-256-GCM under HMAC_SHA256(secret, "crabcrop/seal-key"), associated data
// "crabcrop/sealed/1", a fresh random 12-byte nonce, `s1.` + base64url(nonce || ciphertext
// || tag).

export const BASE = 'https://img.example.com/';
export const SRC = 'root:photos/print.jpg';
export const NAME = 'print.jpg';          // a sealed URL's friendly name: cosmetic, never parsed
export const SECRET = 'demo-secret';

// The five choices, in the order the dive makes them, and each one's options in the order
// of its radio buttons in template.html (ui.choices holds indices into these lists).
export const KEYS = ['format', 'look', 'crop', 'finish', 'seal'];
export const OPTIONS = {
  format: ['', 'format(avif)', 'format(jxl)', 'format(webp)'],
  look: ['sharpen(1.2):saturation(1.1)', 'duotone(0d202e,ffd88a)', 'sepia'],
  crop: ['crop:1200x630:smart', 'crop:760x760:smart', 'fit-in:1200x630'],
  finish: ['', 'studio(product,bg:brand,shadow:soft,pad:10)', 'removebg'],
  seal: ['', 's1'],
};
// What each option does, said once it is picked (the line under the choice reads it out).
export const NOTES = {
  format: [
    'No format named: the browser’s Accept header decides.',
    'AVIF for every request: a named format wins over Accept.',
    'JPEG XL for every request: a named format wins over Accept.',
    'WebP for every request: a named format wins over Accept.',
  ],
  look: [
    'Sharpened a touch, with a little more color.',
    'Two inks: deep blue for the shadows, sand for the light.',
    'The warm brown of an old print.',
  ],
  crop: [
    '1200 × 630, the window moved to the subject.',
    '760 × 760, the window moved to the subject.',
    'Fits inside 1200 × 630, nothing cut.',
  ],
  finish: [
    'Nothing added: the picture leaves as photographed.',
    'Cut out, set on your brand color with a soft shadow, a 10% margin per side.',
    'The background removed: only the subject stays, on transparency, so it needs a format that carries alpha. Browsers ask for one; for curl, name format(webp).',
  ],
  seal: [
    'Readable: the recipe stays in plain sight. It is the right default for most links.',
    'Sealed: the whole recipe is one opaque token. The server opens it and serves the same render.',
  ],
};

// Everything after the signature: the size, then the filters in the order the server runs
// them (the look, the finish, the format, written last), then the source.
export function remainder(c) {
  const f = [OPTIONS.look[c.look], OPTIONS.finish[c.finish], OPTIONS.format[c.format]].filter(Boolean).join(':');
  return OPTIONS.crop[c.crop] + (f ? '/filters:' + f : '') + '/' + SRC;
}

const utf8 = (s) => new TextEncoder().encode(s);

// ---- SHA-256 and HMAC, small and synchronous ---------------------------------------------

const K = new Uint32Array(64), H0 = new Uint32Array(8);
{
  // the fractional parts of the cube roots of the first 64 primes (and square roots of the first 8)
  const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0;
  for (let n = 2, i = 0; i < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (i < 8) H0[i] = frac(Math.sqrt(n));
    K[i++] = frac(Math.cbrt(n));
  }
}
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(msg) {
  const len = msg.length, n = ((len + 72) >> 6) << 6;   // the message, 0x80, padding and an 8-byte length
  const m = new Uint8Array(n);
  m.set(msg);
  m[len] = 0x80;
  const v = new DataView(m.buffer);
  v.setUint32(n - 8, Math.floor(len / 0x20000000));
  v.setUint32(n - 4, (len << 3) >>> 0);
  const h = H0.slice(), w = new Uint32Array(64);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) + w[i - 16];
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

export function hmac(key, msg) {
  if (key.length > 64) key = sha256(key);
  const ipad = new Uint8Array(64 + msg.length), opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { const k = key[i] || 0; ipad[i] = k ^ 0x36; opad[i] = k ^ 0x5c; }
  ipad.set(msg, 64);
  opad.set(sha256(ipad), 64);
  return sha256(opad);
}

const hex = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; };

// The signature of a remainder: 64 lowercase hex characters.
export const sign = (rem, secret = SECRET) => hex(hmac(utf8(secret), utf8(rem)));

// ---- sealing -----------------------------------------------------------------------------

const b64url = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// A sealed token for a remainder, `s1.` and the rest. Resolves to null where the browser
// has no Web Crypto (a page that is not served securely): the page then says how to mint one.
// (`nonce` is for the spec's test vectors only: a nonce must never repeat under one secret.)
export async function seal(rem, secret = SECRET, nonce) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  try {
    const key = await subtle.importKey('raw', hmac(utf8(secret), utf8('crabcrop/seal-key')), 'AES-GCM', false, ['encrypt']);
    const iv = nonce || globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8('crabcrop/sealed/1'), tagLength: 128 }, key, utf8(rem)));
    const body = new Uint8Array(12 + ct.length);
    body.set(iv);
    body.set(ct, 12);
    return 's1.' + b64url(body);
  } catch (e) {
    return null;
  }
}
