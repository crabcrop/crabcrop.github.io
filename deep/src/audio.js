// The dive's sound, all of it synthesized with Web Audio: no file is loaded. It stays off
// until the visitor turns it on; the first setEnabled(true) must come from a click or a
// key press, and that is when the AudioContext is made.
//
// Every voice is made once and then only steered, so nothing is allocated while it runs:
//   rumble   brown noise under a 150 Hz low-pass, heavier the deeper the dive
//   wash     band-passed noise that swells and ebbs like waves overhead, near the surface
//   rush     noise whose pitch and level follow how fast the camera moves
//   drone    a slow chord of stacked fifths on A, darker with depth
//   bubbles  short rising blips now and then, more often in the shallows
//   chimes   soft bell notes (the cues below)
//   whale    a long gliding call now and then in the deep, answered from the other side
// It all goes through a reverb whose impulse is made here from noise, then a limiter, then
// a soft clipper whose output never reaches full scale.
//
// frame(p, depthMetres, speed, dt), once per animation frame:
//   p            where the camera is on its path, 0 to 8 (not used yet; kept for the scene)
//   depthMetres  how deep the story is, in metres (the sign is ignored: storyDepth(p) works)
//   speed        how fast the camera moves along its path, in p per second (|dp| / dt);
//                about 0.6 and above is a full rush of water
//   dt           seconds since the last frame
//
// cue(name):
//   'choice'   two or three soft chime notes, higher in the shallows, lower in the deep
//   'zone'     one low, slow bell under everything: the camera entered another zone
//   'start'    a splash and a burst of bubbles: the visitor pressed Dive
//   'surface'  a bright splash, the waves back, and a rising chime: the surface again
//
// createAudio({ context, solo }) is for tests only: an OfflineAudioContext to render into,
// and the name of one layer to hear alone.

const LAYERS = ['rumble', 'wash', 'rush', 'drone', 'bubbles', 'chimes', 'whale', 'splash'];
// a pentatonic scale on D, two octaves, for the chimes
const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880, 987.77, 1174.66];

const smooth = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

export function createAudio(opts = {}) {
  let ctx = null, live = true, N = null, offTimer = 0;
  let sp = 0, upd = 0, nextBubble = 1.2, nextWhale = 5, depth = 0, bi = 0, ci = 0, wi = 0;
  const api = { enabled: false, setEnabled, frame, cue };
  // (for tests: the AudioContext's state, or 'none' before the first setEnabled(true))
  Object.defineProperty(api, 'state', { get: () => (ctx ? ctx.state : 'none') });

  function setEnabled(on) {
    on = !!on;
    if (on && !ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!opts.context && !AC) return;
      try {
        ctx = opts.context || new AC({ latencyHint: 'playback' });
      } catch (e) { return; }
      live = !opts.context;
      build();
      if (live) {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) ctx.suspend();
          else if (api.enabled) ctx.resume();
        });
      }
    }
    api.enabled = on;
    if (!ctx) return;
    const t = ctx.currentTime, g = N.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 1 : 0, t, on ? 0.7 : 0.12);
    if (!live) return;
    clearTimeout(offTimer);
    if (on) { if (ctx.state !== 'running') ctx.resume(); }
    else offTimer = setTimeout(() => { if (!api.enabled) ctx.suspend(); }, 900);
  }

  // ---- the graph, made once ----------------------------------------------------------

  function build() {
    const c = ctx, sr = c.sampleRate;
    const gain = (v, ...to) => { const g = c.createGain(); g.gain.value = v; for (const n of to) g.connect(n); return g; };
    const filter = (type, f, q, to) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); return b; };
    const osc = (type, f, to) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(); return o; };
    const pan = (to) => { const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain(); p.connect(to); return p; };
    const loop = (buf, to, offset) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(to); s.start(0, offset || 0); return s; };

    // the end of the chain: a limiter, then a soft clip
    const clip = c.createWaveShaper();
    clip.curve = softClip();
    clip.oversample = '2x';
    clip.connect(c.destination);
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -12; lim.knee.value = 6; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.3;
    lim.connect(clip);
    const master = gain(0, lim);
    const dry = gain(1, master);
    const verb = c.createConvolver();
    verb.buffer = impulse(c, 3.6);
    verb.connect(gain(0.5, master));
    const send = gain(1, verb);

    // each layer ends in a bus with a dry level and a reverb send
    const bus = {};
    const layer = (name, d, s) => { const g = gain(opts.solo && opts.solo !== name ? 0 : 1, gain(d, dry), gain(s, send)); bus[name] = g; return g; };

    const white = noise(c, 4, false), brown = noise(c, 9, true);

    // rumble
    const rumble = gain(0.08, layer('rumble', 1, 0.15));
    loop(brown, filter('lowpass', 150, 0.6, rumble));

    // wash: the waves overhead swell and ebb on two slow, unrelated rhythms
    const wash = gain(0, layer('wash', 0.9, 0.35));
    const wave = gain(0.5, wash);
    loop(white, filter('highpass', 220, 0.5, filter('bandpass', 750, 0.45, wave)));
    osc('sine', 0.11, gain(0.32, wave.gain));
    osc('sine', 0.29, gain(0.14, wave.gain));

    // rush
    const rush = gain(0, layer('rush', 1, 0.25));
    const rushF = filter('bandpass', 300, 0.8, rush);
    loop(white, rushF, 1.7);

    // drone: stacked fifths on A1, each a pair a few cents apart, under a slow low-pass
    const drone = gain(0.05, layer('drone', 0.8, 0.6));
    const droneF = filter('lowpass', 900, 0.7, drone);
    const breath = gain(0.75, droneF);
    osc('sine', 0.045, gain(0.25, breath.gain));
    osc('sine', 0.031, gain(140, droneF.frequency));
    [[55, 'sine', 0.5], [82.5, 'triangle', 0.32], [123.75, 'triangle', 0.2], [185.625, 'sine', 0.12]].forEach(([f, type, v]) => {
      const g = gain(v, breath);
      osc(type, f * 1.0017, g);
      osc(type, f / 1.0017, g);
    });

    // bubbles: a few voices, each a sine that rises, used in turn
    const bubbles = layer('bubbles', 0.9, 0.45);
    const bub = [];
    for (let i = 0; i < 6; i++) { const p = pan(bubbles), g = gain(0, p); bub.push({ o: osc('sine', 600, g), g, p }); }

    // chimes: a few bell voices, a sine and its inharmonic partial
    const chimes = layer('chimes', 0.55, 0.9);
    const chime = [];
    for (let i = 0; i < 6; i++) {
      const p = pan(chimes), a = gain(0, p), b = gain(0, p);
      chime.push({ o1: osc('sine', 440, a), o2: osc('sine', 440 * 2.76, b), a, b, p });
    }

    // the whale: a saw through a moving formant, with vibrato that grows as it calls
    const whale = layer('whale', 0.3, 1);
    const whales = [];
    for (let i = 0; i < 2; i++) {
      const p = pan(whale), g = gain(0, p);
      const lp = filter('lowpass', 900, 0.5, g);
      const form = filter('bandpass', 400, 3, lp);
      const o = osc('sawtooth', 120, form);
      const vib = gain(0, o.frequency);
      osc('sine', 4.2 + i * 0.7, vib);
      whales.push({ o, form, g, vib, p });
    }

    // splash: noise through a falling band-pass
    const splash = gain(0, layer('splash', 0.9, 0.5));
    const splashF = filter('bandpass', 1800, 0.9, splash);
    loop(white, splashF, 2.9);

    N = { master, bus, rumble, wash, rush, rushF, drone, droneF, bub, chime, whales, splash, splashF, sr };
  }

  // ---- what plays ----------------------------------------------------------------------

  // Start an envelope on a gain that may still be sounding: a 10 ms fade first, no click.
  function env(param, t, peak, attack, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(0, t + 0.01);
    param.linearRampToValueAtTime(peak, t + 0.01 + attack);
    param.exponentialRampToValueAtTime(0.0005, t + 0.01 + attack + decay);
    param.linearRampToValueAtTime(0, t + 0.02 + attack + decay);
  }

  function blip(t, f0, amp, side) {
    const v = N.bub[bi];
    bi = (bi + 1) % N.bub.length;
    const dur = 0.05 + 0.05 * Math.random();
    v.o.frequency.cancelScheduledValues(t);
    v.o.frequency.setValueAtTime(f0, t + 0.01);
    v.o.frequency.exponentialRampToValueAtTime(f0 * (1.8 + Math.random()), t + 0.01 + dur);
    env(v.g.gain, t, amp, 0.003, dur);
    if (v.p.pan) v.p.pan.setValueAtTime(side, t);
  }

  function bubbleBurst(t, n, spread, amp) {
    for (let i = 0; i < n; i++) blip(t + Math.random() * spread, 380 + Math.random() * 900, amp * (0.5 + 0.5 * Math.random()), Math.random() * 1.6 - 0.8);
  }

  function ring(t, f, amp, decay, side) {
    const v = N.chime[ci];
    ci = (ci + 1) % N.chime.length;
    v.o1.frequency.setValueAtTime(f, t + 0.01);
    v.o2.frequency.setValueAtTime(f * 2.76, t + 0.01);
    env(v.a.gain, t, amp, 0.006, decay);
    env(v.b.gain, t, amp * 0.3, 0.003, decay * 0.3);
    if (v.p.pan) v.p.pan.setValueAtTime(side, t);
  }

  function call(t, base, dur, amp, side) {
    const w = N.whales[wi];
    wi = (wi + 1) % N.whales.length;
    const f = w.o.frequency, ff = w.form.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(base, t);
    f.linearRampToValueAtTime(base * 1.75, t + dur * 0.45);
    f.exponentialRampToValueAtTime(base * 1.2, t + dur);
    ff.cancelScheduledValues(t);
    ff.setValueAtTime(base * 2.6, t);
    ff.linearRampToValueAtTime(base * 4.2, t + dur * 0.45);
    ff.exponentialRampToValueAtTime(base * 2.4, t + dur);
    const g = w.g.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amp, t + dur * 0.3);
    g.setValueAtTime(amp, t + dur * 0.7);
    g.linearRampToValueAtTime(0, t + dur);
    const v = w.vib.gain;
    v.cancelScheduledValues(t);
    v.setValueAtTime(0, t);
    v.linearRampToValueAtTime(base * 0.035, t + dur * 0.6);
    v.linearRampToValueAtTime(0, t + dur);
    if (w.p.pan) w.p.pan.setValueAtTime(side, t);
  }

  function whaleSong(t) {
    const base = 105 + Math.random() * 45, side = Math.random() < 0.5 ? -0.6 : 0.6;
    call(t, base, 3.2 + Math.random() * 1.4, 0.5, side);
    // and an answer, from the other side, a little higher and farther off
    call(t + 4 + Math.random() * 2.5, base * (1.12 + Math.random() * 0.2), 2.6 + Math.random(), 0.3, -side);
  }

  function splash(t, bright) {
    const f = N.splashF.frequency, g = N.splash.gain;
    f.cancelScheduledValues(t);
    f.setValueAtTime(bright ? 2800 : 1900, t);
    f.exponentialRampToValueAtTime(320, t + 1.1);
    env(g, t, bright ? 0.4 : 0.5, 0.02, 1.1);
  }

  function cue(name) {
    if (!api.enabled || !ctx) return;
    const t = ctx.currentTime + 0.02;
    const deep = smooth(30, 900, depth);
    if (name === 'choice') {
      // higher in the sunlit water, an octave lower in the deep
      const root = Math.floor(Math.random() * 3) + (deep > 0.5 ? 0 : 4);
      const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) ring(t + i * 0.085, SCALE[Math.min(SCALE.length - 1, root + i * 2)], 0.11 - i * 0.015, 2.4, (i - 1) * 0.35);
    } else if (name === 'zone') {
      ring(t, deep > 0.5 ? 110 : 146.83, 0.14, 4.5, 0);
      ring(t + 0.03, deep > 0.5 ? 164.81 : 220, 0.07, 4, 0.2);
    } else if (name === 'start') {
      splash(t, false);
      bubbleBurst(t + 0.15, 9, 1.4, 0.11);
    } else if (name === 'surface') {
      splash(t, true);
      bubbleBurst(t, 6, 0.8, 0.09);
      for (let i = 0; i < 3; i++) ring(t + 0.35 + i * 0.12, SCALE[5 + i * 2], 0.09, 2.8, (i - 1) * 0.4);
    }
  }

  // Once per animation frame. Allocates nothing; moves the layers toward where they
  // should be about sixteen times a second.
  function frame(p, depthMetres, speed, dt) {
    if (!api.enabled || !ctx || !(dt > 0)) return;
    const d = depthMetres < 0 ? -depthMetres : depthMetres || 0;
    depth = d;
    const s = speed < 0 ? -speed : speed || 0;
    sp += (s - sp) * (1 - Math.exp(-dt * 5));
    upd -= dt;
    if (upd <= 0) {
      upd = 0.06;
      const t = ctx.currentTime;
      const surf = 1 - smooth(0, 10, d);      // 1 at the surface, gone by 10 m
      const deep = smooth(30, 900, d);        // 0 in the sunlit water, 1 in the deep
      const rush = sp >= 0.6 ? 1 : sp / 0.6;
      N.wash.gain.setTargetAtTime(0.34 * surf, t, 0.5);
      N.rumble.gain.setTargetAtTime(0.08 + 0.1 * deep, t, 0.8);
      N.rushF.frequency.setTargetAtTime(260 + 1500 * rush, t, 0.15);
      N.rush.gain.setTargetAtTime(0.3 * rush * Math.sqrt(rush), t, 0.12);
      N.droneF.frequency.setTargetAtTime(1000 - 720 * deep, t, 1.2);
      N.drone.gain.setTargetAtTime(0.05 + 0.025 * deep, t, 1.5);
    }
    // bubbles, more often in the shallows and around the vents
    nextBubble -= dt;
    if (nextBubble <= 0) {
      const t = ctx.currentTime + 0.02, warm = d < 40 || d > 2000;
      const n = 1 + Math.floor(Math.random() * (warm ? 4 : 2));
      for (let i = 0; i < n; i++) blip(t + i * (0.03 + 0.07 * Math.random()), 420 + Math.random() * 800, 0.05 + 0.06 * Math.random(), Math.random() * 1.6 - 0.8);
      nextBubble = 1.4 + Math.random() * (warm ? 3.5 : 8);
    }
    // the whale, below the light: a few seconds after the dive passes 300 m, then now and then
    if (d > 300) {
      nextWhale -= dt;
      if (nextWhale <= 0) { whaleSong(ctx.currentTime + 0.05); nextWhale = 18 + Math.random() * 14; }
    } else nextWhale = 5;
  }

  return api;
}

// ---- made once: noise, the reverb's impulse, the clipper's curve --------------------------

// Stereo noise to loop: white, or brown. The brown is leaky-integrated noise (brown above
// its corner near 140 Hz, flat below, so it never wanders off), levelled by its RMS, and its
// last tenth of a second runs on into its first, so the loop has no seam.
function noise(c, seconds, brown) {
  const n = Math.floor(c.sampleRate * seconds), m = 4096, buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (!brown) { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; continue; }
    const tail = new Float32Array(m);
    let v = 0, e = 0;
    for (let i = -2048; i < n + m; i++) {
      v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      if (i >= n) tail[i - n] = v; else if (i >= 0) d[i] = v;
    }
    for (let i = 0; i < m; i++) { const k = i / m; d[i] = d[i] * Math.sqrt(k) + tail[i] * Math.sqrt(1 - k); }
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const g = 0.28 / Math.sqrt(e / n);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return buf;
}

// A dark, long room: decaying noise that loses its highs as it fades, a little different
// in each ear.
function impulse(c, seconds) {
  const sr = c.sampleRate, n = Math.floor(sr * seconds), buf = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = 0.35 + 0.6 * Math.min(1, t / 2);
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.exp(-t * 2.1) * (t < 0.02 ? t / 0.02 : 1);
    }
  }
  return buf;
}

// Straight up to 0.6, then bending smoothly toward 0.92, never past it.
function softClip() {
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a <= 0.6 ? a : 0.6 + 0.32 * Math.tanh((a - 0.6) / 0.32);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

export { LAYERS };
