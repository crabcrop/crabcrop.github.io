// The benchmark, for real hardware: open the page with ?bench. The camera descends the
// whole dive at a steady pace (40 seconds), every frame's time is logged, and at the end a
// report shows, per zone: average, 99th percentile and worst frame (from the frame clock),
// the GPU's own time for the scene where WebGPU can measure it, draw calls, triangles,
// and how much the JavaScript heap grew over the run. The report can be copied.
import { ZONES } from './layout.js';

export function runBench({ S, engine, place, draw, resize }) {
  const DURATION = 40, total = Math.ceil(DURATION * 144) + 64;
  const ms = new Float32Array(total), gpu = new Float32Array(total), ps = new Float32Array(total), calls = new Uint32Array(total), tris = new Uint32Array(total);
  let i = 0, start = 0, last = 0;
  engine.scale = 1;
  resize();
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  const r = engine.renderer;
  return new Promise((done) => {
    const step = async (now) => {
      if (!start) { start = now; last = now; }
      const t = (now - start) / 1000;
      const p = Math.min(8, (t / DURATION) * 8);
      S.time = t; S.dt = (now - last) / 1000;
      if (i > 0) ms[i - 1] = now - last;
      last = now;
      place(p);
      draw();
      ps[i] = p; calls[i] = engine.calls; tris[i] = engine.tris;
      if (r.backend.isWebGPUBackend && r.hasFeature && r.hasFeature('timestamp-query')) {
        r.resolveTimestampsAsync('render').then((v) => { if (typeof v === 'number') gpu[Math.max(0, i - 1)] = v; }).catch(() => {});
      }
      i++;
      if (t < DURATION && i < total - 1) { requestAnimationFrame(step); return; }
      ms[i - 1] = ms[i - 2] || 16.7;
      const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
      done(report(i, ms, gpu, ps, calls, tris, heap0, heap1, engine));
    };
    requestAnimationFrame(step);
  });
}

function stats(list) {
  if (!list.length) return { avg: 0, p99: 0, worst: 0 };
  const s = [...list].sort((a, b) => a - b);
  return { avg: s.reduce((a, b) => a + b, 0) / s.length, p99: s[Math.min(s.length - 1, Math.floor(s.length * 0.99))], worst: s[s.length - 1] };
}

function report(n, ms, gpu, ps, calls, tris, heap0, heap1, engine) {
  const lines = [];
  const ua = navigator.userAgent.replace(/\s+/g, ' ');
  lines.push(`crabcrop dive benchmark · ${new Date().toISOString()}`);
  lines.push(`${engine.webgpu ? 'WebGPU' : 'WebGL 2'} · level ${engine.level} · ${engine.width}×${engine.height} · ${n} frames`);
  lines.push(ua);
  lines.push('');
  lines.push('zone                     frames   avg ms   p99 ms  worst ms  gpu ms  draws  triangles');
  const all = [], allGpu = [];
  for (let z = 0; z < 8; z++) {
    const f = [], g = [];
    let c = 0, t = 0;
    for (let i = 0; i < n; i++) if (Math.floor(Math.min(ps[i], 7.999)) === z) { f.push(ms[i]); if (gpu[i] > 0) g.push(gpu[i]); c = Math.max(c, calls[i]); t = Math.max(t, tris[i]); }
    all.push(...f); allGpu.push(...g);
    const s = stats(f), sg = stats(g);
    lines.push(`${ZONES[z].name.padEnd(24)} ${String(f.length).padStart(6)} ${s.avg.toFixed(1).padStart(8)} ${s.p99.toFixed(1).padStart(8)} ${s.worst.toFixed(1).padStart(9)} ${(g.length ? sg.avg.toFixed(1) : '–').padStart(7)} ${String(c).padStart(6)} ${String(t).padStart(10)}`);
  }
  const s = stats(all), sg = stats(allGpu);
  lines.push(`${'whole dive'.padEnd(24)} ${String(all.length).padStart(6)} ${s.avg.toFixed(1).padStart(8)} ${s.p99.toFixed(1).padStart(8)} ${s.worst.toFixed(1).padStart(9)} ${(allGpu.length ? sg.avg.toFixed(1) : '–').padStart(7)}`);
  lines.push('');
  lines.push(heap0 ? `JS heap: ${(heap0 / 1048576).toFixed(1)} MB at the start, ${(heap1 / 1048576).toFixed(1)} MB at the end` : 'JS heap: this browser does not report it');
  lines.push(allGpu.length ? 'gpu ms: the GPU\'s own time for the scene, from WebGPU timestamp queries' : 'gpu ms: not available here (needs WebGPU with timestamp queries)');
  return lines.join('\n');
}

// Show the report over the page, with a button to copy it.
export function showReport(text) {
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Benchmark report');
  box.style.cssText = 'position:fixed;inset:5vh 5vw;z-index:50;background:rgba(4,18,26,.94);color:#eef2ec;border:1px solid rgba(238,242,236,.25);border-radius:12px;padding:20px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  const pre = document.createElement('pre');
  pre.textContent = text;
  pre.style.cssText = 'margin:0 0 16px;white-space:pre-wrap';
  const copy = document.createElement('button');
  copy.textContent = 'Copy the report';
  copy.style.cssText = 'font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #E8482F;background:#E8482F;color:#fff;cursor:pointer';
  copy.addEventListener('click', () => { navigator.clipboard.writeText(text).then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Select the text and copy it'; }); });
  box.append(pre, copy);
  document.body.appendChild(box);
}
