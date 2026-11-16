// Snap's favourite photo print: a little felt picture, cream, with a stitched edge, two teal
// hills and a yellow sun, all stitched (as in the painted dive). Drawn once on a canvas at
// load; the same picture is in his claw at the start, in the geode at the end, and is what
// the visitor's URL serves.
import { CanvasTexture, SRGBColorSpace } from 'three/webgpu';
import { makeRng } from './math.js';

export const FELT_ASPECT = 600 / 420;
let tex = null;

export function feltPrint() {
  if (tex) return tex;
  const W = 600, H = 420, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), rng = makeRng(6061);
  // felt: cream, faintly mottled, a soft darker rim where the edge is turned under
  g.fillStyle = '#f1e7d2';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,250,238,0.10)' : 'rgba(196,178,146,0.08)';
    g.beginPath(); g.arc(rng() * W, rng() * H, 6 + rng() * 22, 0, Math.PI * 2); g.fill();
  }
  const rim = g.createLinearGradient(0, 0, 0, H);
  rim.addColorStop(0, 'rgba(150,128,96,0.10)'); rim.addColorStop(0.08, 'rgba(0,0,0,0)'); rim.addColorStop(0.92, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(150,128,96,0.14)');
  g.fillStyle = rim; g.fillRect(0, 0, W, H);
  // a running stitch: short dashes along a path, each with a light side and a shadow
  const stitch = (path, color, width = 3.2, dash = [11, 8]) => {
    g.save(); g.lineCap = 'round'; g.setLineDash(dash);
    g.strokeStyle = 'rgba(60,40,20,0.22)'; g.lineWidth = width + 1.6; g.translate(0.8, 1.2); path(); g.stroke();
    g.translate(-0.8, -1.2); g.strokeStyle = color; g.lineWidth = width; path(); g.stroke();
    g.restore();
  };
  // the edge
  const edge = () => { g.beginPath(); g.roundRect(18, 18, W - 36, H - 36, 14); };
  stitch(edge, '#d8c7a6', 3.4, [9, 7]);
  // the hills: the far one paler, the near one in front, each filled, then stitched round
  const hill = (pts) => () => {
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 6) g.bezierCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
  };
  const far = hill([250, 352, 300, 300, 340, 222, 410, 222, 474, 222, 520, 300, 548, 352]);
  const near = hill([62, 352, 104, 270, 160, 150, 236, 150, 312, 150, 362, 262, 404, 352]);
  for (const [path, fill, line] of [[far, '#7cc0b8', '#4f958d'], [near, '#3f9a95', '#2c7571']]) {
    path(); g.closePath(); g.fillStyle = fill; g.fill();
    // a few rows of stitches inside, along the slope
    g.save(); path(); g.closePath(); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 2; g.setLineDash([7, 9]);
    for (let y = 160; y < 360; y += 22) { g.beginPath(); g.moveTo(40, y + 30); g.quadraticCurveTo(300, y - 40, 560, y + 30); g.stroke(); }
    g.restore();
    stitch(path, line, 3.6, [10, 7]);
  }
  // the ground line under the hills
  stitch(() => { g.beginPath(); g.moveTo(54, 352); g.lineTo(W - 54, 352); }, '#2c7571', 3.2, [10, 7]);
  // the sun, with short stitched rays
  const sx = 470, sy = 112, sr = 38;
  g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fillStyle = '#f3b62e'; g.fill();
  g.beginPath(); g.arc(sx - 9, sy - 10, sr * 0.55, 0, Math.PI * 2); g.fillStyle = 'rgba(255,230,140,0.45)'; g.fill();
  stitch(() => { g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); }, '#d4921b', 3.2, [8, 6]);
  g.save(); g.lineCap = 'round'; g.strokeStyle = '#e6a325'; g.lineWidth = 4.2;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.2, r0 = sr + 12, r1 = sr + 30;
    g.beginPath(); g.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0); g.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1); g.stroke();
  }
  g.restore();
  // the fibres of the felt, over everything
  for (let i = 0; i < 5200; i++) {
    const x = rng() * W, y = rng() * H, a = rng() * Math.PI, l = 2 + rng() * 6;
    g.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(80,60,30,0.07)';
    g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
