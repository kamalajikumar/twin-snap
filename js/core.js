/*
 * Twin Snap — core simulation. Pure logic, no DOM, runs in the browser and in Node tests.
 * The whole level is mirrored around the centre line, so the game state is one number:
 * `w`, the distance of each twin from the centre. Hold pushes the twins apart, release
 * slams them back together.
 *
 * The run object is mutated in place on purpose: this is the 120 Hz hot loop and
 * allocating per step would cause GC hitches on phones.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TS = root.TS || {}).Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = Object.freeze({
    W: 360, // logical width of the playfield
    HALF: 180,
    R: 14, // twin radius as drawn
    HIT_R: 11, // forgiving collision radius
    W_MAX: 166, // twins touch the side walls here
    V_OUT: 560, // split speed while holding
    V_IN: 820, // snap speed after release
    BLEND: 16, // how quickly velocity follows the thumb
    SNAP_SPEED: 260, // closing speed that counts as a real snap
    CRUSH_SPEED: 220,
    ROW_H: 26,
    CRYSTAL_R: 15,
    GRAZE: 5, // clearance below this is a close call
    OPEN: 999, // "no side blocks" marker for row.b
    STEP: 1 / 120,
    // Fever: a full meter makes the twins unstoppable for a few seconds.
    FEVER_TIME: 6,
    FEVER_GRACE: 0.6, // hidden safety window after fever ends, so it never ends inside a block
    FEVER_SPEED: 1.3,
    CHARGE_GEM: 0.1,
    CHARGE_GRAZE: 0.12,
    CHARGE_CRUSH: 0.34,
  });

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const EASY_ROWS = 6; // warm-up: only "hold" and "let go" rows, with generous sizes

  /*
   * Rows appear at the top edge, so the distance from the top to the twins decides how long
   * every row is on screen before it arrives. That distance is capped at the H=640 reference,
   * round(640 * 0.74) = 474: taller screens show extra space below the twins, not extra warning,
   * so every screen gets the same preview time.
   */
  const TWIN_LINE_MAX = 474;
  /** @param {number} H logical viewport height @returns {number} y of the twins */
  const twinLine = (H) => Math.min(Math.round(H * 0.74), TWIN_LINE_MAX);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Difficulty curves. `gates` is how many rows the player has cleared, `d` the row ordinal.
  // Gentle first minute, then a second, slower ramp so even expert runs eventually end.
  const speed = (gates) => Math.min(226 + gates * 2.7, 490) + clamp((gates - 90) * 0.8, 0, 90);
  const gapWidth = (d) => Math.max(124 - d * 0.8, 76) - clamp((d - 70) * 0.1, 0, 12);
  const rowTime = (d) => Math.max(1.12 - d * 0.008, 0.66);

  function stepTwin(tw, held, dt) {
    const target = held ? C.V_OUT : -C.V_IN;
    tw.v += (target - tw.v) * (1 - Math.exp(-C.BLEND * dt));
    tw.w += tw.v * dt;
    let ev = null;
    if (tw.w <= 0) {
      if (!tw.closed && -tw.v > C.SNAP_SPEED) ev = 'snap';
      tw.w = 0;
      tw.v = 0;
      tw.closed = true;
    } else {
      tw.closed = false;
      if (tw.w >= C.W_MAX) {
        tw.w = C.W_MAX;
        if (tw.v > 0) tw.v = 0;
      }
    }
    return ev;
  }

  function pickKind(gen, rng, d) {
    if (d < EASY_ROWS) return d % 2 ? 'jaws' : 'core';
    const r = rng();
    const pTunnel = d >= 16 ? 0.1 : 0;
    const pOsc = d >= 24 ? 0.14 : 0;
    const pGate = clamp(0.14 + (d - EASY_ROWS) * 0.012, 0.14, 0.55);
    let kind;
    if (r < pTunnel) kind = 'tunnel';
    else if (r < pTunnel + pOsc) kind = 'osc';
    else if (r < pTunnel + pOsc + pGate) kind = 'gate';
    else kind = rng() < 0.5 ? 'core' : 'jaws';
    // Two cores or two jaws in a row need no thumb movement, so alternate them.
    if ((kind === 'core' || kind === 'jaws') && kind === gen.prevKind) {
      kind = kind === 'core' ? 'jaws' : 'core';
    }
    return kind;
  }

  function makeRow(gen, rng) {
    const d = gen.index++;
    const kind = pickKind(gen, rng, d);
    const easy = d < EASY_ROWS;
    let a = -1;
    let b = C.OPEN;
    let h = C.ROW_H;
    let osc = null;
    let target = 0;

    if (kind === 'core') {
      a = 26 + rng() * (easy ? 45 : 92);
      target = a + C.R + 22;
    } else if (kind === 'jaws') {
      b = (easy ? 70 : 44) + rng() * (easy ? 40 : 86);
      target = 0;
    } else {
      const amp = kind === 'osc' ? 22 : 0;
      const g = gapWidth(d) + (kind === 'tunnel' ? 24 : kind === 'osc' ? 16 : 0);
      const cMin = g / 2 + 12 + amp;
      const cMax = C.W_MAX + 2 - g / 2 - amp;
      const c = cMin + rng() * (cMax - cMin);
      a = c - g / 2;
      b = c + g / 2;
      target = c;
      if (kind === 'tunnel') h = 110 + rng() * 50;
      if (kind === 'osc') osc = { amp, freq: 0.8 + rng() * 0.5, phase: rng() * Math.PI * 2 };
    }

    const row = {
      n: d, kind, y: 0, h, a, b, ca: a, cb: b, osc, target,
      passed: false, broken: false, minClr: 99, flash: 0,
    };

    let pick = null;
    if (d >= 1) {
      const r = rng();
      const calm = (k) => k === 'core' || k === 'jaws' || k === 'gate';
      const reachable = gen.prevTarget <= 130 && (a <= 0 || a + C.R <= 95);
      if (d >= 4 && r < 0.26 && calm(kind) && calm(gen.prevKind) && reachable) {
        pick = { type: 'crystal', y: 0, g: 0, spin: rng() * 6 };
      } else if (r < 0.7) {
        const g = clamp((gen.prevTarget + target) / 2 + (rng() - 0.5) * 50, 18, 158);
        pick = { type: 'gem', y: 0, g, spin: rng() * 6 };
      }
    }

    gen.prevKind = kind;
    gen.prevTarget = target;
    return { row, pick };
  }

  function placeGap(row, time) {
    if (!row.osc) return;
    const off = row.osc.amp * Math.sin(row.osc.phase + time * row.osc.freq * Math.PI * 2);
    row.ca = row.a + off;
    row.cb = row.b + off;
  }

  // Circle (twin, in half-space coordinates) against the row's centre block and side block.
  function hits(row, w, ty) {
    const dy = Math.max(row.y - ty, 0, ty - (row.y + row.h));
    if (dy >= C.HIT_R) return false;
    const rr = C.HIT_R * C.HIT_R;
    if (row.ca > 0) {
      const dx = Math.max(0, w - row.ca);
      if (dx * dx + dy * dy < rr) return true;
    }
    if (row.cb < C.HALF) {
      const dx = Math.max(0, row.cb - w);
      if (dx * dx + dy * dy < rr) return true;
    }
    return false;
  }

  function clearance(row, w) {
    const inner = row.ca > 0 ? w - C.R - row.ca : 99;
    const outer = row.cb < C.HALF ? row.cb - C.R - w : 99;
    return Math.min(inner, outer);
  }

  function createRun(seed, H) {
    return {
      rng: mulberry32(seed),
      H,
      TY: twinLine(H),
      twin: { w: 0, v: 0, closed: true },
      rows: [],
      picks: [],
      score: 0,
      gates: 0,
      gems: 0,
      chain: 0,
      charge: 0, // fever meter, 0..1
      fever: -1, // seconds of fever left; anything above -FEVER_GRACE still protects
      time: 0,
      spawnGap: 60,
      gen: { index: 0, prevKind: '', prevTarget: 0 },
      dead: false,
      events: [],
    };
  }

  function spawn(run) {
    const made = makeRow(run.gen, run.rng);
    const row = made.row;
    row.y = -row.h - 10;
    placeGap(row, run.time);
    const prev = run.rows[run.rows.length - 1];
    if (made.pick && prev) {
      made.pick.y = (row.y + row.h + prev.y) / 2;
      run.picks.push(made.pick);
    }
    run.rows.push(row);
    run.spawnGap = speed(run.gates) * rowTime(run.gen.index) + row.h;
  }

  function addCharge(run, amount, ev) {
    if (run.fever > 0) return;
    run.charge += amount;
    if (run.charge >= 1) {
      run.charge = 0;
      run.fever = C.FEVER_TIME;
      ev.push({ t: 'fever' });
    }
  }

  function stepRows(run, dy, ev) {
    const tw = run.twin;
    const TY = run.TY;
    const shielded = run.fever > -C.FEVER_GRACE;
    const mult = run.fever > 0 ? 2 : 1;
    for (let i = 0; i < run.rows.length; i++) {
      const row = run.rows[i];
      row.y += dy;
      placeGap(row, run.time);
      if (row.passed) continue;
      if (!row.broken && hits(row, tw.w, TY)) {
        if (!shielded) {
          run.dead = true;
          ev.push({ t: 'dead' });
          return;
        }
        row.broken = true;
        run.score += 2;
        ev.push({ t: 'smash', row });
      }
      if (!row.broken && TY + C.R > row.y && TY - C.R < row.y + row.h) {
        const c = clearance(row, tw.w);
        if (c < row.minClr) row.minClr = c;
      }
      if (row.y > TY + C.R) {
        row.passed = true;
        run.gates++;
        const graze = !row.broken && row.minClr < C.GRAZE;
        run.score += (graze ? 2 : 1) * mult;
        ev.push({ t: 'pass', graze, row });
        if (graze) addCharge(run, C.CHARGE_GRAZE, ev);
      }
    }
  }

  function stepPicks(run, dy, snapped, ev) {
    const tw = run.twin;
    const TY = run.TY;
    for (let i = run.picks.length - 1; i >= 0; i--) {
      const p = run.picks[i];
      p.y += dy;
      const near = Math.abs(p.y - TY);
      let taken = false;
      if (p.type === 'gem') {
        if (near < C.R + 10 && Math.abs(p.g - tw.w) < C.R + 10) {
          run.gems++;
          ev.push({ t: 'gem', g: p.g });
          addCharge(run, C.CHARGE_GEM, ev);
          taken = true;
        }
      } else if (near < C.CRYSTAL_R + C.R && tw.w < C.CRYSTAL_R + C.R - 4) {
        if (snapped || tw.v < -C.CRUSH_SPEED) {
          run.chain++;
          const bonus = Math.min(1 + run.chain, 5);
          run.score += bonus;
          run.gems += 2;
          ev.push({ t: 'crush', chain: run.chain, bonus, y: p.y });
          addCharge(run, C.CHARGE_CRUSH, ev);
          taken = true;
        }
      } else if (p.y > TY + 60 && !p.missed) {
        p.missed = true;
        if (run.chain > 0) ev.push({ t: 'miss' });
        run.chain = 0;
      }
      if (taken || p.y > run.H + 60) run.picks.splice(i, 1);
    }
  }

  function stepRun(run, held, dt) {
    const ev = run.events;
    ev.length = 0;
    if (run.dead) return ev;
    run.time += dt;
    if (run.fever > -C.FEVER_GRACE) {
      const wasOn = run.fever > 0;
      run.fever -= dt;
      if (wasOn && run.fever <= 0) ev.push({ t: 'feverEnd' });
    }
    const dy = speed(run.gates) * dt * (run.fever > 0 ? C.FEVER_SPEED : 1);
    const twinEvent = stepTwin(run.twin, held, dt);
    if (twinEvent) ev.push({ t: twinEvent });
    stepRows(run, dy, ev);
    if (run.dead) return ev;
    stepPicks(run, dy, twinEvent === 'snap', ev);
    while (run.rows.length && run.rows[0].y > run.H + 60) run.rows.shift();
    run.spawnGap -= dy;
    if (run.spawnGap <= 0) spawn(run);
    return ev;
  }

  // Second chance: clear everything near the twins and hand control back.
  function reviveRun(run) {
    const limit = run.TY - 380;
    run.rows = run.rows.filter((r) => r.y + r.h < limit);
    run.picks = run.picks.filter((p) => p.y < limit);
    run.twin.w = 0;
    run.twin.v = 0;
    run.twin.closed = true;
    run.dead = false;
    run.spawnGap = Math.max(run.spawnGap, 40);
  }

  /**
   * Adapt a run to a new viewport height without moving anything relative to the twins.
   * The twin line moves to twinLine(H) and every row and pickup moves with it, so a
   * resize can neither push the twins into a block nor make a row count as passed.
   * `spawnGap` is the distance still to scroll before the next row spawns at the top;
   * the newest row is now dy further along, so the gap shrinks by dy. Shrinking (dy < 0)
   * delays the next spawn and keeps the designed spacing; growing (dy > 0) may spawn on the
   * next step with a one-off gap larger than designed, never smaller.
   * No events, scoring or RNG use.
   * A height that is not a finite number above zero is ignored: it would turn every position
   * into NaN or Infinity and the run could never recover.
   * @param {object} run
   * @param {number} H new logical viewport height
   * @returns {number} dy, the shift applied to world y (callers move their own y-based state by it)
   */
  function resizeRun(run, H) {
    if (!Number.isFinite(H) || H <= 0) return 0;
    const TY = twinLine(H);
    const dy = TY - run.TY;
    run.H = H;
    run.TY = TY;
    if (dy === 0) return 0;
    for (let i = 0; i < run.rows.length; i++) run.rows[i].y += dy;
    for (let i = 0; i < run.picks.length; i++) run.picks[i].y += dy;
    run.spawnGap -= dy;
    return dy;
  }

  function nextRow(run) {
    let best = null;
    for (let i = 0; i < run.rows.length; i++) {
      const r = run.rows[i];
      if (!r.passed && (!best || r.y > best.y)) best = r;
    }
    return best;
  }

  // Simple autopilot: used for the title-screen demo and to prove levels are beatable.
  function botHeld(run, greedy) {
    const tw = run.twin;
    const row = nextRow(run);
    let target = 0;
    if (row) {
      if (row.ca <= 0) target = 0;
      else if (row.cb >= C.HALF) target = row.ca + C.R + 24;
      else target = (row.ca + row.cb) / 2;
    }
    if (greedy) {
      const S = speed(run.gates);
      for (let i = 0; i < run.picks.length; i++) {
        const p = run.picks[i];
        if (p.type !== 'crystal') continue;
        const ahead = run.TY - p.y;
        const rowClear = !row || row.y + row.h < p.y - C.R;
        if (rowClear && ahead > -12) {
          const lead = S * (tw.w / C.V_IN + 0.07) + 6;
          target = ahead < lead ? 0 : Math.max(target, 70);
        }
      }
    }
    return tw.w + tw.v * 0.045 < target;
  }

  return {
    C, clamp, mulberry32, speed, gapWidth, rowTime, twinLine,
    stepTwin, makeRow, hits, clearance, createRun, stepRun, reviveRun, resizeRun, nextRow, botHeld,
  };
});
