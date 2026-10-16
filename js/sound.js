// Sounds, all synthesised (no recordings): the engines of the traffic on Newark Road, placed and Doppler-shifted
// as they pass; wind and rain from the weather; birdsong that follows the time of day, the month, the rain and the
// trees about you; and your own footsteps, harder on roads and pavements than on grass. St Bartholomew's clock is
// silent: nothing says it strikes.
export class Soundscape {
  constructor() { this.ctx = null; this.on = true; this.voices = new Map(); this.birdT = 0; this.stepD = 0; }

  // must be called from a user gesture (a click or key press) for the browser to allow sound
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.8 : 0; this.master.connect(ctx.destination);
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = (filters) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = Math.random();
      let node = src;
      for (const [type, f, q] of filters) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; node.connect(b); node = b; }
      const g = ctx.createGain(); g.gain.value = 0; node.connect(g); g.connect(this.master); src.start();
      return { g, f: node };
    };
    this.wind = loop([['lowpass', 380]]);
    this.rain = loop([['highpass', 900], ['lowpass', 7000]]);
    document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else if (this.on) ctx.resume(); });
  }

  toggle() {
    this.on = !this.on;
    if (this.ctx) this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, this.ctx.currentTime, 0.1);
    return this.on;
  }

  // s: { x, z, yaw (radians, the way the camera faces), cars: [{ obj, v, mixer }], weather: { windSpeed, rain, snow },
  //      hour 0..24, month 1..12, trees (0..1, how wooded it is round about), step (studs walked this frame), hard }
  update(dt, s) {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') return;
    const now = ctx.currentTime, w = s.weather;
    // wind and rain beds
    this.wind.g.gain.setTargetAtTime(Math.min(0.16, 0.012 + w.windSpeed * 0.011), now, 1);
    this.wind.f.frequency.setTargetAtTime(300 + w.windSpeed * 40 + 120 * Math.sin(now * 0.3), now, 0.5);
    this.rain.g.gain.setTargetAtTime(w.rain > 0.05 && !w.snow ? Math.min(0.3, 0.06 + w.rain * 0.05) : 0, now, 0.8);
    this.engines(s, now);
    this.birds(dt, s, now);
    this.steps(s, now);
  }

  // where a point is from the listener: distance (metres) and left-right pan
  place(s, x, z) {
    const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) * 0.7;
    const right = [Math.cos(s.yaw), -Math.sin(s.yaw)];   // camera right in x/z for a yaw where forward is (-sin, -cos)
    return { d, pan: Math.max(-1, Math.min(1, (dx * right[0] + dz * right[1]) / (Math.hypot(dx, dz) || 1))) };
  }

  engines(s, now) {
    const ctx = this.ctx, live = new Set(s.cars);
    for (const [car, v] of this.voices) if (!live.has(car)) { v.g.gain.setTargetAtTime(0, now, 0.1); setTimeout(() => { v.stop(); }, 400); this.voices.delete(car); }
    for (const car of s.cars) {
      let v = this.voices.get(car);
      if (!v) {
        // an engine: a low buzzing tone and its octave, and road noise from the tyres
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square';
        const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = car.mixer ? 260 : 420;
        const tyre = ctx.createBiquadFilter(); tyre.type = 'bandpass'; tyre.frequency.value = 900; tyre.Q.value = 0.6;
        const ge = ctx.createGain(); ge.gain.value = 0.35; const gt = ctx.createGain(); gt.gain.value = 0.5;
        const g = ctx.createGain(); g.gain.value = 0; const pan = ctx.createStereoPanner();
        o1.connect(lp); o2.connect(lp); lp.connect(ge); ge.connect(g); src.connect(tyre); tyre.connect(gt); gt.connect(g); g.connect(pan); pan.connect(this.master);
        o1.start(); o2.start(); src.start();
        v = { o1, o2, g, pan, last: null, base: car.mixer ? 32 : 50 + Math.random() * 12, stop: () => { try { o1.stop(); o2.stop(); src.stop(); } catch (e) { /* stopped */ } } };
        this.voices.set(car, v);
      }
      const p = car.obj.position, { d, pan } = this.place(s, p.x, p.z);
      // Doppler: the speed towards the listener since the last frame
      const dNow = d, vr = v.last == null ? 0 : (v.last - dNow) / Math.max(1e-3, now - v.lastT);
      v.last = dNow; v.lastT = now;
      const shift = 343 / Math.max(200, 343 - Math.max(-60, Math.min(60, vr)));
      const rev = 0.65 + 0.35 * Math.min(1, car.v / 13);
      v.o1.frequency.setTargetAtTime(v.base * rev * shift, now, 0.05); v.o2.frequency.setTargetAtTime(v.base * 2 * rev * shift, now, 0.05);
      const loud = (car.mixer ? 0.5 : 0.32) * (0.4 + 0.6 * Math.min(1, car.v / 13)) / (1 + (d / 12) ** 2);
      v.g.gain.setTargetAtTime(loud, now, 0.05); v.pan.pan.setTargetAtTime(pan, now, 0.05);
    }
  }

  // birdsong: phrases at a rate set by the hour (the dawn chorus, quiet at night), the month (spring loudest), the
  // rain (it hushes them) and how many trees there are about
  birds(dt, s, now) {
    const h = s.hour, m = s.month;
    const daily = h < 4.5 || h > 21 ? 0 : h < 8.5 ? 1.6 : h < 11 ? 0.9 : h < 17 ? 0.5 : h < 20 ? 0.8 : 0.3;
    const yearly = m >= 3 && m <= 6 ? 1 : m <= 8 ? 0.55 : m <= 11 ? 0.35 : 0.3;
    const rate = daily * yearly * (0.25 + 0.75 * s.trees) * (s.weather.rain > 0.05 ? 0.15 : 1);
    this.birdT -= dt * rate;
    if (this.birdT > 0) return;
    this.birdT = 0.4 + Math.random() * 1.6;
    const ctx = this.ctx, pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain(); g.gain.value = 0.02 + Math.random() * 0.03; g.connect(pan); pan.connect(this.master);
    const kind = Math.random(), t0 = now + 0.02;
    const note = (t, f0, f1, len, amp = 1) => {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(amp, t + len * 0.2); e.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(e); e.connect(g); o.start(t); o.stop(t + len + 0.02);
    };
    if (kind < 0.4) {          // a warbled phrase of falling and rising notes
      let t = t0; const n = 4 + Math.floor(Math.random() * 6), base = 2600 + Math.random() * 1800;
      for (let i = 0; i < n; i++) { const f = base * (0.8 + Math.random() * 0.5), len = 0.06 + Math.random() * 0.1; note(t, f, f * (Math.random() < 0.5 ? 0.75 : 1.3), len); t += len + 0.02 + Math.random() * 0.05; }
    } else if (kind < 0.7) {   // a trill
      const f = 3500 + Math.random() * 2000, n = 8 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) note(t0 + i * 0.045, f, f * 0.92, 0.04, 0.8);
    } else {                   // a two-note call, repeated
      const a = 2200 + Math.random() * 1500, b = a * (0.7 + Math.random() * 0.2), r = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < r; i++) { note(t0 + i * 0.5, a, a * 1.02, 0.18); note(t0 + i * 0.5 + 0.22, b, b * 0.98, 0.22); }
    }
    setTimeout(() => { g.disconnect(); pan.disconnect(); }, 4000);
  }

  // a footstep every stride: a crisp scuff on hard ground, a soft thud on grass
  steps(s, now) {
    this.stepD += s.step;
    if (this.stepD < 1.6) return;
    this.stepD = 0;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = s.hard ? 1 : 0.6;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = s.hard ? 2200 : 500; f.Q.value = s.hard ? 1.2 : 0.8;
    const g = ctx.createGain(), len = s.hard ? 0.07 : 0.12;
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(s.hard ? 0.22 : 0.16, now + 0.008); g.gain.exponentialRampToValueAtTime(0.001, now + len);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(now, Math.random()); src.stop(now + len + 0.02);
  }
}
