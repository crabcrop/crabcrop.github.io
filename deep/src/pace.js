// Keeping the frame rate: the controller watches how long frames take and trades
// resolution for time, in small steps, before anything else. It lowers the resolution
// quickly when frames run slow and raises it slowly when there is room (so it does not
// hunt), and remembers where it settled for the next visit. Nothing here allocates.
const SLOW = 1000 / 52, FAST = 1000 / 66;        // average frame time that is too slow, and that leaves room
const N = 90;

export function createPace(engine, onScale) {
  const times = new Float32Array(N);
  let n = 0, at = 0, slowRuns = 0, fastRuns = 0, since = 0;
  const minScale = engine.q.minScale;
  try {
    const saved = parseFloat(localStorage.getItem('deep-scale-' + engine.level));
    if (saved >= minScale && saved <= 1) engine.scale = saved;
  } catch (e) { /* storage may be shut */ }
  const remember = () => { try { localStorage.setItem('deep-scale-' + engine.level, String(engine.scale)); } catch (e) { /* fine */ } };
  return {
    // one frame took ms; hidden tabs and long stalls (a tab switch) do not count
    frame(ms) {
      if (ms > 250) return;
      times[at] = ms; at = (at + 1) % N; if (n < N) n++;
      since += ms;
      if (since < 1000 || n < 30) return;
      since = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += times[i];
      const avg = sum / n;
      if (avg > SLOW) { slowRuns++; fastRuns = 0; } else if (avg < FAST) { fastRuns++; slowRuns = 0; } else { slowRuns = 0; fastRuns = 0; }
      if (slowRuns >= 2 && engine.scale > minScale + 1e-3) {
        engine.scale = Math.max(minScale, engine.scale - 0.12); slowRuns = 0; n = 0; onScale(); remember();
      } else if (fastRuns >= 5 && engine.scale < 1 - 1e-3) {
        engine.scale = Math.min(1, engine.scale + 0.06); fastRuns = 0; n = 0; onScale(); remember();
      }
    },
    // the line for the H key
    stats(out) {
      let sum = 0, worst = 0;
      for (let i = 0; i < n; i++) { sum += times[i]; if (times[i] > worst) worst = times[i]; }
      const avg = n ? sum / n : 0;
      return `${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} worst · ${(1000 / Math.max(avg, 1)).toFixed(0)} fps · ${engine.width}×${engine.height} (${Math.round(engine.scale * 100)}%) · ${engine.level} · ${engine.webgpu ? 'WebGPU' : 'WebGL 2'} · ${engine.calls} draws · ${(engine.tris / 1000).toFixed(0)}k tris`;
    },
  };
}
