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
