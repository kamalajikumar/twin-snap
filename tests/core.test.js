'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

const { C } = Core;

function play(seed, { greedy = false, maxGates = 150, H = 640 } = {}) {
  const run = Core.createRun(seed, H);
  let crushes = 0;
  let gems = 0;
  let guard = 0;
  while (!run.dead && run.gates < maxGates && guard++ < 120 * 600) {
    const events = Core.stepRun(run, Core.botHeld(run, greedy), C.STEP);
    for (const e of events) {
      if (e.t === 'crush') crushes++;
      if (e.t === 'gem') gems++;
    }
  }
  return { run, crushes, gems };
}

test('twins split while held and stay inside the walls', () => {
  // Arrange
  const tw = { w: 0, v: 0, closed: true };
  // Act
  for (let i = 0; i < 240; i++) Core.stepTwin(tw, true, C.STEP);
  // Assert
  assert.equal(tw.w, C.W_MAX);
  assert.equal(tw.v, 0);
});

test('releasing from wide open produces exactly one snap', () => {
  const tw = { w: 150, v: 0, closed: false };
  let snaps = 0;
  for (let i = 0; i < 240; i++) if (Core.stepTwin(tw, false, C.STEP) === 'snap') snaps++;
  assert.equal(snaps, 1);
  assert.equal(tw.w, 0);
});

test('resting closed never fires a snap', () => {
  const tw = { w: 0, v: 0, closed: true };
  for (let i = 0; i < 240; i++) assert.equal(Core.stepTwin(tw, false, C.STEP), null);
});

test('same seed gives the same level', () => {
  const rows = (seed) => {
    const gen = { index: 0, prevKind: '', prevTarget: 0 };
    const rng = Core.mulberry32(seed);
    return Array.from({ length: 50 }, () => Core.makeRow(gen, rng).row.target);
  };
  assert.deepEqual(rows(42), rows(42));
  assert.notDeepEqual(rows(42), rows(43));
});

test('every generated row leaves a gap the twins fit through', () => {
  const gen = { index: 0, prevKind: '', prevTarget: 0 };
  const rng = Core.mulberry32(7);
  for (let i = 0; i < 2000; i++) {
    const { row, pick } = Core.makeRow(gen, rng);
    const amp = row.osc ? row.osc.amp : 0;
    // A moving gap keeps its width; only its sweep has to stay inside the reachable range.
    const lo = row.a > 0 ? row.a + C.R : 0;
    const hi = row.b < C.HALF ? row.b - C.R : C.W_MAX;
    assert.ok(hi - lo >= 30, `row ${i} (${row.kind}) gap too small: ${hi - lo}`);
    assert.ok(lo - amp >= 0 && hi + amp <= C.W_MAX + 0.001, `row ${i} gap outside reach`);
    if (pick && pick.type === 'gem') assert.ok(pick.g >= 0 && pick.g <= C.W_MAX);
  }
});

test('collision: centre block kills a closed twin, spares a wide one', () => {
  const row = { y: 100, h: 26, ca: 60, cb: C.OPEN };
  assert.equal(Core.hits(row, 0, 110), true);
  assert.equal(Core.hits(row, 60 + C.HIT_R + 1, 110), false);
  assert.equal(Core.hits(row, 0, 100 - C.HIT_R - 1), false);
});

test('collision: side blocks kill a wide twin, spare a closed one', () => {
  const row = { y: 100, h: 26, ca: -1, cb: 80 };
  assert.equal(Core.hits(row, 100, 110), true);
  assert.equal(Core.hits(row, 0, 110), false);
});

test('difficulty ramps but stays bounded', () => {
  assert.ok(Core.speed(0) < Core.speed(40));
  assert.equal(Core.speed(10000), 580);
  assert.ok(Core.speed(80) < Core.speed(150), 'late ramp keeps expert runs finite');
  assert.ok(Core.gapWidth(0) > Core.gapWidth(40));
  assert.ok(Core.gapWidth(10000) >= 2 * C.R + 30);
  assert.ok(Core.rowTime(10000) >= 0.6);
});

test('doing nothing dies on the first centre block', () => {
  const run = Core.createRun(1, 640);
  for (let i = 0; i < 120 * 10 && !run.dead; i++) Core.stepRun(run, false, C.STEP);
  assert.equal(run.dead, true);
  assert.equal(run.gates, 0);
});

test('levels are beatable: the autopilot clears 150 gates on many seeds', () => {
  let cleared = 0;
  const total = 40;
  const fails = [];
  for (let seed = 1; seed <= total; seed++) {
    const { run } = play(seed);
    if (run.gates >= 150) cleared++;
    else fails.push(`${seed}:${run.gates}`);
  }
  assert.ok(cleared >= total * 0.9, `only ${cleared}/${total} cleared (${fails.join(' ')})`);
});

test('crystals can be crushed and gems collected in real play', () => {
  let crushes = 0;
  let gems = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = play(seed, { greedy: true, maxGates: 60 });
    crushes += r.crushes;
    gems += r.gems;
  }
  assert.ok(crushes >= 10, `crushes ${crushes}`);
  assert.ok(gems >= 10, `gems ${gems}`);
});

test('a full meter starts fever, and fever smashes blocks instead of dying', () => {
  // Arrange: meter one gem short of full, twins closed, first centre block on its way
  const run = Core.createRun(1, 640);
  run.charge = 0.95;
  run.picks.push({ type: 'gem', y: run.TY - 5, g: 0, spin: 0 });
  const seen = new Set();
  // Act
  for (let i = 0; i < 120 * 4 && !run.dead; i++) {
    for (const e of Core.stepRun(run, false, C.STEP)) seen.add(e.t);
  }
  // Assert
  assert.equal(run.dead, false);
  assert.ok(seen.has('fever'), 'fever started');
  assert.ok(seen.has('smash'), 'block was smashed');
  assert.ok(run.score >= 2);
});

test('fever runs out and the twins become mortal again', () => {
  const run = Core.createRun(1, 640);
  run.fever = C.FEVER_TIME;
  let ended = false;
  for (let i = 0; i < 120 * 30 && !run.dead; i++) {
    for (const e of Core.stepRun(run, false, C.STEP)) if (e.t === 'feverEnd') ended = true;
  }
  assert.equal(ended, true);
  assert.equal(run.dead, true);
});

test('the meter does not charge while fever is already running', () => {
  const run = Core.createRun(1, 640);
  run.fever = 3;
  run.picks.push({ type: 'gem', y: run.TY - 5, g: 0, spin: 0 });
  Core.stepRun(run, false, C.STEP);
  assert.equal(run.charge, 0);
  assert.equal(run.gems, 1);
});

test('revive clears the danger zone and resumes the run', () => {
  const run = Core.createRun(3, 640);
  while (!run.dead) Core.stepRun(run, false, C.STEP);
  Core.reviveRun(run);
  assert.equal(run.dead, false);
  assert.ok(run.rows.every((r) => r.y + r.h < run.TY - 380));
  for (let i = 0; i < 60; i++) Core.stepRun(run, false, C.STEP);
  assert.equal(run.dead, false);
});

// --- Viewport resize (B1) ---------------------------------------------------------------

// Float tolerance for positions after shifting: y + dy rounds when the exponent changes.
const EPS = 1e-9;

const counters = (run) => ({
  score: run.score, gates: run.gates, gems: run.gems, chain: run.chain,
  charge: run.charge, fever: run.fever, dead: run.dead,
});
const relRows = (run) => run.rows.map((r) => r.y - run.TY);
const relPicks = (run) => run.picks.map((p) => p.y - run.TY);

function assertClose(actual, expected, msg) {
  assert.equal(actual.length, expected.length, `${msg}: length`);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= EPS, `${msg}[${i}]: ${actual[i]} vs ${expected[i]}`);
  }
}

function botSteps(run, n) {
  for (let i = 0; i < n && !run.dead; i++) Core.stepRun(run, Core.botHeld(run, false), C.STEP);
}

test('resizing mid-run does not drop the twins into an approaching row', () => {
  // Arrange: first centre block ~260 units above the closed twins (confirmed repro)
  const run = Core.createRun(5, 640);
  while (!run.rows.length || run.rows[0].y < 200) Core.stepRun(run, false, C.STEP);
  const before = counters(run);
  // Act
  Core.resizeRun(run, 300);
  const afterResize = counters(run);
  const ev = Core.stepRun(run, false, C.STEP).map((e) => e.t);
  // Assert
  assert.deepEqual(afterResize, before);
  assert.equal(run.dead, false);
  assert.ok(!ev.includes('dead'));
  assert.equal(run.gates, before.gates);
  assert.equal(run.score, before.score);
});

test('shrinking the viewport never counts an uncleared row as passed', () => {
  // Arrange: a centre block 40 units above the twin line, twins closed (not cleared)
  const run = Core.createRun(1, 640);
  while (!run.rows.length || run.rows[0].y < run.TY - 40) Core.stepRun(run, false, C.STEP);
  const row = run.rows[0];
  // The old code moved TY to round(400 * 0.74) = 296, putting this row below TY + R.
  assert.ok(row.y > Math.round(400 * 0.74) + C.R, 'precondition: old bug would pass this row');
  const before = counters(run);
  // Act
  Core.resizeRun(run, 400);
  const afterResize = counters(run);
  const ev = Core.stepRun(run, false, C.STEP).map((e) => e.t);
  // Assert
  assert.deepEqual(afterResize, before);
  assert.ok(!ev.includes('pass'), `unexpected events ${ev}`);
  assert.equal(row.passed, false);
  assert.equal(run.gates, 0);
  assert.equal(run.score, 0);
});

test('resizeRun keeps every row and pickup at the same distance from the twins', () => {
  for (const H of [520, 880]) {
    // Arrange
    const run = Core.createRun(2, 640);
    botSteps(run, 1500);
    assert.ok(run.rows.length > 1 && run.picks.length > 0, 'precondition: rows and picks on screen');
    const rows = relRows(run);
    const picks = relPicks(run);
    const before = counters(run);
    const gap = run.spawnGap;
    const oldTY = run.TY;
    // Act
    const dy = Core.resizeRun(run, H);
    // Assert
    assert.equal(run.H, H);
    assert.equal(run.TY, Core.twinLine(H));
    assert.equal(dy, run.TY - oldTY);
    assertClose(relRows(run), rows, `rows H=${H}`);
    assertClose(relPicks(run), picks, `picks H=${H}`);
    assert.ok(Math.abs(run.spawnGap - (gap - dy)) <= EPS, 'spawnGap shifted by -dy');
    assert.deepEqual(counters(run), before);
  }
});

test('resizeRun to the same height changes nothing', () => {
  // Arrange
  const run = Core.createRun(2, 640);
  botSteps(run, 1500);
  const rows = run.rows.map((r) => r.y);
  const picks = run.picks.map((p) => p.y);
  const state = { ...counters(run), H: run.H, TY: run.TY, spawnGap: run.spawnGap };
  // Act
  const dy = Core.resizeRun(run, 640);
  // Assert
  assert.equal(dy, 0);
  assert.deepEqual(run.rows.map((r) => r.y), rows);
  assert.deepEqual(run.picks.map((p) => p.y), picks);
  assert.deepEqual({ ...counters(run), H: run.H, TY: run.TY, spawnGap: run.spawnGap }, state);
});

test('resizeRun ignores invalid heights and leaves the run untouched', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -100]) {
    // Arrange: a run in mid-play with rows and pickups on screen
    const run = Core.createRun(2, 640);
    botSteps(run, 1500);
    assert.ok(run.rows.length > 1 && run.picks.length > 0, 'precondition: rows and picks on screen');
    const snapshot = () => ({
      ...counters(run),
      H: run.H,
      TY: run.TY,
      spawnGap: run.spawnGap,
      genIndex: run.gen.index,
      rows: run.rows.map((r) => r.y),
      picks: run.picks.map((p) => p.y),
    });
    const before = snapshot();
    // Act
    const dy = Core.resizeRun(run, bad);
    // Assert
    assert.equal(dy, 0, `H=${bad}: reported a shift`);
    assert.deepEqual(snapshot(), before, `H=${bad}: run state changed`);
  }
});

test('a run survives an invalid resize and keeps playing normally', () => {
  // Arrange
  const run = Core.createRun(2, 640);
  botSteps(run, 1500);
  const gates = run.gates;
  // Act
  for (const bad of [NaN, Infinity, 0, -100]) Core.resizeRun(run, bad);
  botSteps(run, 1500);
  // Assert: rows still spawn, move and get cleared
  assert.equal(run.dead, false);
  assert.ok(run.gates > gates, 'no progress after invalid resizes');
  assert.ok(run.rows.every((r) => Number.isFinite(r.y)), 'row positions corrupted');
  assert.ok(Number.isFinite(run.spawnGap) && Number.isFinite(run.TY));
});

test('resizing 640 -> 520 -> 880 -> 640 restores the run', () => {
  // Arrange
  const run = Core.createRun(4, 640);
  botSteps(run, 1500);
  const rows = run.rows.map((r) => r.y);
  const picks = run.picks.map((p) => p.y);
  const gap = run.spawnGap;
  const TY = run.TY;
  // Act
  for (const H of [520, 880, 640]) Core.resizeRun(run, H);
  // Assert: TY and H exact; positions within EPS (float addition of integer shifts)
  assert.equal(run.H, 640);
  assert.equal(run.TY, TY);
  assertClose(run.rows.map((r) => r.y), rows, 'rows');
  assertClose(run.picks.map((p) => p.y), picks, 'picks');
  assert.ok(Math.abs(run.spawnGap - gap) <= EPS, 'spawnGap');
});

// Rows already on screen play out identically. Rows spawned after the resize cannot: spawn()
// resets spawnGap and drops the overshoot, so spawns snap to step boundaries and a shift that
// is not a whole number of steps lands later rows a fraction of a step off. That nudges pass
// timing by a step, which feeds speed(gates) at later spawns, so the two runs drift apart
// slowly (a gate count at most 1 apart, never a death).
test('shrinking mid-run plays out like the unresized run', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange: two identical runs, one shrunk while rows are on screen
    const a = Core.createRun(seed, 640);
    const b = Core.createRun(seed, 640);
    const warmup = 600 + seed * 137;
    for (let i = 0; i < warmup; i++) {
      Core.stepRun(a, Core.botHeld(a, false), C.STEP);
      Core.stepRun(b, Core.botHeld(b, false), C.STEP);
    }
    assert.ok(b.rows.some((r) => !r.passed) && !b.dead, 'precondition: rows on screen');
    const lastOnScreen = b.rows[b.rows.length - 1].n;
    // Act
    Core.resizeRun(b, 520);
    // Assert
    let exactSteps = 0;
    for (let i = 0; i < 6000; i++) {
      // Gates before this step: rows 0..lastOnScreen are the ones that existed at resize time.
      const oldRowsLeft = a.gates <= lastOnScreen && b.gates <= lastOnScreen;
      Core.stepRun(a, Core.botHeld(a, false), C.STEP);
      Core.stepRun(b, Core.botHeld(b, false), C.STEP);
      if (oldRowsLeft) {
        // Every row that existed at resize time (and its pass) behaves identically.
        assert.equal(`${b.gates}/${b.score}/${b.dead}`, `${a.gates}/${a.score}/${a.dead}`, `seed ${seed} step ${i}`);
        exactSteps++;
      }
      assert.ok(Math.abs(a.gates - b.gates) <= 1, `seed ${seed} step ${i}: gates ${a.gates} vs ${b.gates}`);
      assert.equal(b.dead, a.dead, `seed ${seed} step ${i}: dead`);
    }
    assert.ok(exactSteps > 60, `seed ${seed}: exact window only ${exactSteps} steps`);
  }
});

test('repeated viewport changes during play neither kill nor award', () => {
  const heights = [520, 880, 600, 760, 640];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const run = Core.createRun(seed, 640);
    const rng = Core.mulberry32(seed * 977);
    let next = 30 + Math.floor(rng() * 60);
    let k = 0;
    let resizes = 0;
    let guard = 0;
    let pending = [];
    // Act / Assert
    while (!run.dead && run.gates < 150 && guard++ < 120 * 600) {
      let resized = false;
      if (--next <= 0) {
        const before = counters(run);
        pending = run.rows.filter((r) => !r.passed).map((r) => [r.n, r.y - run.TY]);
        Core.resizeRun(run, heights[k++ % heights.length]);
        assert.deepEqual(counters(run), before, 'resize changed counters');
        const after = run.rows.filter((r) => !r.passed).map((r) => [r.n, r.y - run.TY]);
        assert.deepEqual(after.map((p) => p[0]), pending.map((p) => p[0]));
        assertClose(after.map((p) => p[1]), pending.map((p) => p[1]), 'pending rows');
        next = 30 + Math.floor(rng() * 60);
        resizes++;
        resized = true;
      }
      const gates = run.gates;
      const scroll = Core.speed(run.gates) * C.STEP * C.FEVER_SPEED; // most a row can move in one step
      const events = Core.stepRun(run, Core.botHeld(run, false), C.STEP);
      const ev = events.map((e) => e.t);
      assert.ok(run.gates >= gates && run.gates - gates <= 1, `seed ${seed}: gates ${gates} -> ${run.gates}`);
      if (resized) {
        assert.ok(!ev.includes('dead'), `seed ${seed}: died right after a resize`);
        // A pass right after a resize must be one the row was about to earn anyway.
        for (const e of events) {
          if (e.t !== 'pass') continue;
          const rel = pending.find((p) => p[0] === e.row.n)[1];
          assert.ok(rel > C.R - scroll - EPS, `seed ${seed}: row ${e.row.n} passed from ${rel} after a resize`);
        }
      }
    }
    assert.ok(resizes > 50, `seed ${seed}: only ${resizes} resizes`);
    assert.ok(run.gates >= 100, `seed ${seed}: bot only cleared ${run.gates} gates with resizes`);
  }
});

// --- Screen-height fairness (B7) ----------------------------------------------------------

test('the twin line follows 74% of the height up to the H=640 depth, then stays there', () => {
  const expected = { 529: 391, 600: 444, 640: 474, 700: 474, 880: 474, 2000: 474 };
  for (const [H, TY] of Object.entries(expected)) assert.equal(Core.twinLine(Number(H)), TY, `H=${H}`);
  for (const H of [529, 640, 880, 2000]) assert.equal(Core.createRun(1, H).TY, Core.twinLine(H), `createRun H=${H}`);
});

test('resizing between heights at or above 640 never moves the twin line', () => {
  for (const [from, to] of [[640, 880], [880, 640]]) {
    // Arrange
    const run = Core.createRun(2, from);
    botSteps(run, 1500);
    const rows = run.rows.map((r) => r.y);
    const picks = run.picks.map((p) => p.y);
    const gap = run.spawnGap;
    const before = counters(run);
    // Act
    const dy = Core.resizeRun(run, to);
    // Assert
    assert.equal(dy, 0, `${from} -> ${to}`);
    assert.equal(run.H, to);
    assert.equal(run.TY, 474);
    assert.deepEqual(run.rows.map((r) => r.y), rows);
    assert.deepEqual(run.picks.map((p) => p.y), picks);
    assert.equal(run.spawnGap, gap);
    assert.deepEqual(counters(run), before);
  }
});

test('resizing 529 -> 640 moves everything with the twin line by +83', () => {
  // Arrange
  const run = Core.createRun(2, 529);
  botSteps(run, 1500);
  const rows = relRows(run);
  const picks = relPicks(run);
  const gap = run.spawnGap;
  const before = counters(run);
  // Act
  const dy = Core.resizeRun(run, 640);
  // Assert
  assert.equal(dy, 83);
  assert.equal(run.TY, 474);
  assertClose(relRows(run), rows, 'rows');
  assertClose(relPicks(run), picks, 'picks');
  assert.ok(Math.abs(run.spawnGap - (gap - 83)) <= EPS);
  assert.deepEqual(counters(run), before);
});

/**
 * Plays one seed with the autopilot and records everything the player could notice: every event
 * with its step, the counters, the twins, and the rows and pickups still in play.
 * Rows that are already passed and pickups more than 60 below the twins are left out: they only
 * wait to be culled past the bottom edge, which is height-dependent and has no gameplay effect.
 */
function gameplayTrace(seed, H, steps) {
  const run = Core.createRun(seed, H);
  const trace = [];
  for (let i = 0; i < steps && !run.dead; i++) {
    const ev = Core.stepRun(run, Core.botHeld(run, true), C.STEP);
    for (const e of ev) trace.push(`${i}:${e.t}${e.row ? ':' + e.row.n : ''}`);
    if (i % 60 === 0 || run.dead) {
      trace.push(JSON.stringify({
        i, ...counters(run), time: run.time, tw: run.twin, gap: run.spawnGap, idx: run.gen.index,
        rows: run.rows.filter((r) => !r.passed).map((r) => [r.n, r.y, r.ca, r.cb, r.broken]),
        picks: run.picks.filter((p) => p.y <= run.TY + 60).map((p) => [p.type, p.y, p.g]),
      }));
    }
  }
  return { trace, gates: run.gates, dead: run.dead };
}

test('the same seed and inputs play identically at H=640, 720 and 880', () => {
  let beaten = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const base = gameplayTrace(seed, 640, 120 * 240);
    for (const H of [720, 880]) {
      const other = gameplayTrace(seed, H, 120 * 240);
      assert.equal(other.trace.length, base.trace.length, `seed ${seed} H=${H}: trace length`);
      for (let k = 0; k < base.trace.length; k++) {
        assert.equal(other.trace[k], base.trace[k], `seed ${seed} H=${H}: first difference at entry ${k}`);
      }
    }
    if (base.gates >= 150 && !base.dead) beaten++;
  }
  assert.ok(beaten >= 11, `only ${beaten}/12 seeds beaten`);
});

test('every row is on screen for the same time before it can touch the twins at 640-880', () => {
  const previews = (H) => {
    const run = Core.createRun(3, H);
    const seen = new Map();
    const out = [];
    while (!run.dead && run.gates < 120) {
      Core.stepRun(run, Core.botHeld(run, false), C.STEP);
      for (const r of run.rows) {
        if (!seen.has(r) && r.y + r.h > 0) seen.set(r, run.time);
        if (seen.has(r) && !r.contactAt && r.y + r.h > run.TY - C.HIT_R) {
          r.contactAt = run.time;
          out.push(r.contactAt - seen.get(r));
        }
      }
    }
    return out;
  };
  const base = previews(640);
  assert.ok(base.length >= 100);
  const worst = (474 - C.HIT_R) / (580 * C.FEVER_SPEED); // top speed, sped up by fever
  assert.ok(Math.min(...base) >= worst - C.STEP, 'preview never below the fastest possible approach');
  for (const H of [720, 880]) assert.deepEqual(previews(H), base, `H=${H}`);
});
