'use strict';
// Rough human model: bang-bang control whose every press/release lands late by a random
// jitter, and which notices the next row only after a reaction delay.
const Core = require(process.argv[2]);
const { C } = Core;

function play(seed, jitterMs, reactMs) {
  const rng = Core.mulberry32(seed * 7919 + 13);
  const run = Core.createRun(seed, 700);
  let held = false, want = false, switchAt = -1, t = 0;
  let curRow = null, seenAt = 0, target = 0, cause = '';
  while (!run.dead && run.gates < 300) {
    t += C.STEP;
    const row = Core.nextRow(run);
    if (row !== curRow) { curRow = row; seenAt = t + reactMs / 1000; }
    if (t >= seenAt && row) {
      target = row.ca <= 0 ? 0 : row.cb >= C.HALF ? C.W_MAX : (row.ca + row.cb) / 2;
    }
    const w = run.twin;
    const desire = w.w + w.v * 0.045 < target;
    if (desire !== want) { want = desire; switchAt = t + (rng() * jitterMs) / 1000; }
    if (switchAt >= 0 && t >= switchAt) { held = want; switchAt = -1; }
    Core.stepRun(run, held, C.STEP);
    if (run.dead) cause = curRow ? curRow.kind : '?';
  }
  return { gates: run.gates, score: run.score, cause };
}

const profiles = [['novice', 130, 320], ['casual', 90, 240], ['good', 60, 180], ['expert', 35, 130]];
for (const [name, j, r] of profiles) {
  const res = [];
  const causes = {};
  for (let s = 1; s <= 400; s++) {
    const x = play(s, j, r);
    res.push(x.gates);
    causes[x.cause] = (causes[x.cause] || 0) + 1;
  }
  res.sort((a, b) => a - b);
  const q = (p) => res[Math.floor(p * (res.length - 1))];
  console.log(name.padEnd(7), 'p10', q(0.1), 'p50', q(0.5), 'p90', q(0.9), 'max', q(1), JSON.stringify(causes));
}
