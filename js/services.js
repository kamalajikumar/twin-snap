/* Twin Snap — device services: save data, sound, haptics, and the ad adapter. */
(function (root) {
  'use strict';
  const TS = (root.TS = root.TS || {});
  const KEY = 'twin-snap-save-v1';
  const DEFAULTS = Object.freeze({ best: 0, gems: 0, owned: ['classic'], skin: 'classic', muted: false, plays: 0 });

  function sanitize(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    const owned = Array.isArray(d.owned) ? d.owned.filter((s) => typeof s === 'string') : [];
    if (!owned.includes('classic')) owned.unshift('classic');
    return {
      best: num(d.best),
      bestGates: num(d.bestGates),
      gems: num(d.gems),
      owned,
      skin: owned.includes(d.skin) ? d.skin : 'classic',
      muted: d.muted === true,
      plays: num(d.plays),
    };
  }

  // Storage can be missing or blocked (private tabs, embedded previews): the game still runs.
  TS.Store = {
    load() {
      try {
        return sanitize(JSON.parse(root.localStorage.getItem(KEY)));
      } catch (err) {
        return sanitize(DEFAULTS);
      }
    },
    /** Returns a new save object with `patch` applied; never mutates `save`. */
    update(save, patch) {
      const next = sanitize({ ...save, ...patch });
      try {
        root.localStorage.setItem(KEY, JSON.stringify(next));
      } catch (err) {
        /* progress simply lasts for this visit */
      }
      return next;
    },
  };

  // ---------- Sound: everything is synthesised, so there are no audio files to ship ----------
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  const Sfx = {
    ctx: null,
    out: null,
    muted: false,
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.55;
        this.out.connect(this.ctx.destination);
      } catch (err) {
        this.ctx = null;
      }
    },
    tone(freq, dur, type, vol, slideTo, delay) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.out);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    },
    noise(dur, vol, filterType, cutoff) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = cutoff;
      const gain = this.ctx.createGain();
      gain.gain.value = vol;
      src.connect(filter).connect(gain).connect(this.out);
      src.start(t);
    },
    buzz(pattern) {
      if (this.muted || !root.navigator || !root.navigator.vibrate) return;
      try {
        root.navigator.vibrate(pattern);
      } catch (err) {
        /* haptics are optional */
      }
    },
    press() { this.tone(300, 0.07, 'sine', 0.07, 520); },
    snap() { this.noise(0.05, 0.3, 'highpass', 1800); this.tone(190, 0.09, 'triangle', 0.3, 80); this.buzz(8); },
    pass(gates) {
      const semis = PENTA[gates % 10] + 12 * Math.min(Math.floor((gates % 30) / 10), 2);
      this.tone(392 * Math.pow(2, semis / 12), 0.11, 'triangle', 0.13);
    },
    graze() { this.tone(1100, 0.12, 'sine', 0.1, 1900); },
    gem() { this.tone(988, 0.07, 'square', 0.05); this.tone(1319, 0.12, 'square', 0.05, null, 0.06); },
    crush(chain) {
      const base = 523 * Math.pow(2, Math.min(chain - 1, 8) / 6);
      this.noise(0.2, 0.35, 'highpass', 3200);
      this.tone(base, 0.22, 'triangle', 0.18);
      this.tone(base * 1.26, 0.22, 'triangle', 0.14, null, 0.03);
      this.tone(base * 1.5, 0.3, 'triangle', 0.14, null, 0.06);
      this.buzz(28);
    },
    level() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'square', 0.06, null, i * 0.07)); },
    dead() { this.tone(240, 0.55, 'sawtooth', 0.28, 38); this.noise(0.45, 0.45, 'lowpass', 900); this.buzz([70, 40, 140]); },
    best() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.14, null, i * 0.09)); },
    fever() {
      [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.18, 'sawtooth', 0.09, null, i * 0.055));
      this.noise(0.5, 0.25, 'highpass', 2500);
      this.buzz([40, 30, 40, 30, 90]);
    },
    feverEnd() { this.tone(660, 0.16, 'triangle', 0.13, 330); this.tone(330, 0.25, 'triangle', 0.1, 165, 0.14); },
    smash(n) {
      this.noise(0.22, 0.5, 'lowpass', 1400);
      this.tone(150 * Math.pow(2, Math.min(n, 8) / 12), 0.2, 'square', 0.16, 55);
      this.buzz(35);
    },
    record() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.14, null, i * 0.07)); },
    click() { this.tone(680, 0.05, 'square', 0.05); },
    buy() { [784, 988, 1175].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.13, null, i * 0.06)); },
  };
  TS.Sfx = Sfx;

  /*
   * Ad adapter. This web build has no ad network: `rewarded` shows a short placeholder so the
   * revive flow can be felt end to end. To ship, replace the two bodies with real SDK calls
   * (for example AdMob through Capacitor) and keep the same promise contract.
   */
  TS.Ads = {
    placeholder: null, // set by the UI layer
    /** @returns {Promise<boolean>} true when the player earned the reward */
    rewarded() {
      return this.placeholder ? this.placeholder() : Promise.resolve(true);
    },
    /** Call between runs; a real build would show an interstitial every few deaths. */
    interstitial() {
      return Promise.resolve(false);
    },
  };
})(self);
