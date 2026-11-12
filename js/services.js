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
      rev: num(d.rev), // write counter; saves from before M0.6b have none and read as 0
    };
  }

  /*
   * Save storage. Storage can be missing, blocked, full or hold a damaged save (private tabs,
   * embedded previews, old data). The game always runs; these functions say exactly what
   * happened so the game can tell the player and never report a save that did not happen.
   */
  const BACKUP_KEY = KEY + '.bak';
  const PROBE_KEY = 'twin-snap-probe'; // temporary, never the save or the backup
  const state = {
    protected: false,
    probeLeft: false,
    corruptRaw: null, // the damaged text seen at startup, if any
    recoveredRaw: null, // that text, once backed up by this session: the first write may replace it
  };
  const MAX_ATTEMPTS = 3;

  /** Classifies a storage exception: 'quota' (full), 'unavailable' (blocked) or 'error'. */
  function reasonOf(err) {
    const name = err && err.name;
    const code = err && err.code;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
    if (name === 'SecurityError') return 'unavailable';
    return 'error';
  }

  const storage = () => root.localStorage; // the getter itself throws when storage is blocked

  /**
   * Copies a corrupt save to BACKUP_KEY and confirms it. Any existing backup, even an identical
   * one, counts as a failure: it is never replaced, and the corrupt original is then kept too.
   */
  function backUp(ls, raw) {
    if (ls.getItem(BACKUP_KEY) !== null) return false;
    ls.setItem(BACKUP_KEY, raw);
    if (ls.getItem(BACKUP_KEY) === raw) return true;
    ls.removeItem(BACKUP_KEY); // our own copy is wrong: do not leave it looking like a backup
    return false;
  }

  /** Writes and removes PROBE_KEY. Returns null if writing works, else the failure reason. */
  function probe(ls) {
    try {
      ls.setItem(PROBE_KEY, '1');
    } catch (err) {
      return reasonOf(err);
    }
    removeProbe(ls);
    return null;
  }

  function removeProbe(ls) {
    try {
      ls.removeItem(PROBE_KEY);
      state.probeLeft = false;
    } catch (err) {
      state.probeLeft = true; // retried before every later write
    }
  }

  /** Reads the raw save, or null if there is none. Throws when storage is blocked. */
  function readRaw() {
    return storage().getItem(KEY);
  }

  /** The save in `raw`, or undefined if it is not a JSON object. */
  function parse(raw) {
    try {
      const d = JSON.parse(raw);
      return d && typeof d === 'object' && !Array.isArray(d) ? d : undefined;
    } catch (err) {
      return undefined;
    }
  }

  /** Recovers from a corrupt save: backed up and writable, or protected for the session. */
  function openCorrupt(ls, raw) {
    let ok = false;
    state.corruptRaw = raw;
    try {
      ok = backUp(ls, raw);
    } catch (err) {
      ok = false;
    }
    if (ok) {
      state.recoveredRaw = raw;
      return 'corrupt-recovered';
    }
    state.protected = true;
    return 'corrupt-protected';
  }

  /*
   * Changes. Every write is a list of changes applied to the latest stored save, never a copy of
   * this tab's memory, so a tab that has not seen another tab's writes cannot undo them. Changes
   * are plain data, so a list can be replayed onto any save with the same result.
   *   run    {earned, score, gates, counted}  end of a run: adds gems and plays, keeps the best
   *   wear   {id}                             wear a skin, only if the save owns it
   *   muted  {value}                          the sound setting the player chose
   *   spend  {amount}                         pay for a revive; refused if the save cannot afford it
   *   buy    {id, cost}                       buy a skin; refused if the save cannot afford it
   */
  function change(s, c) {
    switch (c.type) {
      case 'run':
        return {
          save: { ...s, best: Math.max(s.best, c.score), bestGates: Math.max(s.bestGates, c.gates),
            gems: s.gems + c.earned, plays: s.plays + (c.counted ? 1 : 0) },
        };
      case 'wear':
        return { save: s.owned.includes(c.id) ? { ...s, skin: c.id } : s };
      case 'muted':
        return { save: { ...s, muted: c.value === true } };
      case 'spend':
        if (s.gems < c.amount) return { rejected: 'insufficient' };
        return { save: { ...s, gems: s.gems - c.amount } };
      case 'buy':
        if (s.owned.includes(c.id)) return { save: { ...s, skin: c.id }, note: 'already-owned' };
        if (s.gems < c.cost) return { rejected: 'insufficient' };
        return { save: { ...s, gems: s.gems - c.cost, owned: s.owned.concat(c.id), skin: c.id } };
      default:
        return { save: s };
    }
  }

  /** Applies `changes` in order to a copy of `save`. Pure: the same input gives the same output. */
  function project(save, changes) {
    let s = sanitize(save);
    const notes = [];
    for (let i = 0; i < changes.length; i++) {
      const r = change(s, changes[i]);
      if (r.rejected) return { save: s, rejected: r.rejected, notes };
      if (r.note) notes.push(r.note);
      s = sanitize(r.save);
    }
    return { save: s, notes };
  }

  /** The stored save as a starting point for changes, or a reason it cannot be used. */
  function baseOf(raw) {
    if (raw === null || raw === state.recoveredRaw) return { save: sanitize(DEFAULTS), deleted: raw === null };
    const data = parse(raw);
    return data === undefined ? { reason: 'corrupt' } : { save: sanitize(data) };
  }

  TS.Store = {
    KEYS: Object.freeze({ save: KEY, backup: BACKUP_KEY, probe: PROBE_KEY }),

    /**
     * Loads the save once at startup and checks that storage can be written.
     * @returns {{save: object, status: 'ok'|'new'|'unavailable'|'readonly'|'corrupt-recovered'|'corrupt-protected',
     *   reason?: string, probe?: 'left'}} the save to play with and what was found. `reason` is set
     *   when the startup write test failed ('readonly', or 'corrupt-recovered' on top of a recovery).
     */
    open() {
      let ls;
      let raw;
      try {
        ls = storage();
        raw = readRaw();
      } catch (err) {
        return { save: sanitize(DEFAULTS), status: 'unavailable' };
      }
      let status = raw === null ? 'new' : 'ok';
      let data = raw === null ? DEFAULTS : parse(raw);
      if (data === undefined) {
        status = openCorrupt(ls, raw);
        data = DEFAULTS;
      }
      const out = { save: sanitize(data), status };
      if (!state.protected) {
        const failed = probe(ls);
        if (failed) Object.assign(out, { status: status === 'corrupt-recovered' ? status : 'readonly', reason: failed });
      }
      if (state.probeLeft) out.probe = 'left';
      return out;
    },

    project,

    /**
     * Re-reads and checks the stored save (used when another tab has written).
     * @returns {{ok: boolean, save?: object, deleted?: boolean, reason?: 'corrupt'|'unavailable'|'quota'|'error',
     *   unprotected?: true}} unprotected: a corrupt-protected session may write again, because a
     *   valid save replaced the damaged one and the backup is exactly the damaged text it saw.
     */
    read() {
      let ls;
      let raw;
      try {
        ls = storage();
        raw = readRaw();
      } catch (err) {
        return { ok: false, reason: reasonOf(err) };
      }
      const base = baseOf(raw);
      if (base.reason) return { ok: false, reason: base.reason };
      const out = { ok: true, save: base.save };
      if (base.deleted) out.deleted = true;
      if (state.protected && raw !== null && state.corruptRaw !== null) {
        try {
          if (ls.getItem(BACKUP_KEY) === state.corruptRaw) {
            state.protected = false;
            out.unprotected = true;
          }
        } catch (err) {
          /* cannot confirm the backup: stay protected */
        }
      }
      return out;
    },

    /**
     * The only way the game writes its save: applies `changes` to the latest stored save and
     * writes the result with rev + 1. Before writing it re-reads the save; if another tab wrote in
     * between, it starts again (MAX_ATTEMPTS in all). localStorage has no compare-and-swap, so a
     * write by another tab after that last re-read is still overwritten: this narrows the race, it
     * cannot close it.
     * @param {object[]} changes see change()
     * @returns {{ok: boolean, save?: object, latest?: object, reason?: string, notes?: string[], attempts?: number,
     *   probe?: 'left'}} ok is true only if the new save was written; `save` is set only then.
     *   save: what was written. latest: the stored save it started from (for refreshing).
     *   reason: 'rejected' (a purchase it cannot afford; nothing written), 'conflict' (the stored
     *   save is damaged and not ours to replace), 'busy' (it kept changing), 'protected', 'quota',
     *   'unavailable' or 'error'.
     */
    apply(changes) {
      if (state.protected) return { ok: false, reason: 'protected' };
      let attempts = 0;
      while (attempts < MAX_ATTEMPTS) {
        attempts++;
        let ls;
        let raw;
        try {
          ls = storage();
          raw = readRaw();
        } catch (err) {
          return { ok: false, reason: reasonOf(err), attempts };
        }
        const base = baseOf(raw);
        if (base.reason) return { ok: false, reason: 'conflict', attempts };
        const p = project(base.save, changes);
        if (p.rejected) return { ok: false, reason: 'rejected', latest: base.save, attempts };
        const next = sanitize({ ...p.save, rev: base.save.rev + 1 });
        try {
          if (readRaw() !== raw) continue; // another tab wrote meanwhile: start again
          if (state.probeLeft) removeProbe(ls);
          ls.setItem(KEY, JSON.stringify(next));
        } catch (err) {
          return { ok: false, reason: reasonOf(err), attempts };
        }
        if (raw === state.recoveredRaw) state.recoveredRaw = null;
        const out = { ok: true, save: next, latest: base.save, notes: p.notes, attempts };
        if (state.probeLeft) out.probe = 'left'; // still reported while its removal keeps failing
        return out;
      }
      return { ok: false, reason: 'busy', attempts };
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
   * Ad adapter. This web build has no ad provider, so no reward is ever offered or granted. A
   * real provider (for example AdMob through Capacitor) would replace these bodies, and a reward
   * would be granted only on its verified completion.
   */
  TS.Ads = {
    /** @returns {Promise<boolean>} always false: rewarded ads are unavailable in this build */
    rewarded() {
      return Promise.resolve(false);
    },
    /** Call between runs; a real build would show an interstitial every few deaths. */
    interstitial() {
      return Promise.resolve(false);
    },
  };
})(self);
