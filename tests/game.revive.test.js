'use strict';
/*
 * The revive (M0.6c): it costs 20 gems, is paid against the latest stored save, and is granted
 * only after that payment is saved. There is no ad-funded revive. Uses the stand-in browser and
 * multi-tab bus from tests/helpers/world.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, makeWorld, fakeStorage, storageBus, domError } = require('./helpers/world.js');

const KEY = 'twin-snap-save-v1';
const BAK = KEY + '.bak';
const COST = 20;
const QUOTA = () => domError('QuotaExceededError', 22);
const CANCELLED = "Couldn't save, so the revive was cancelled.";
const DAMAGED = 'Your save data is damaged. This tab cannot safely update your progress.';

function profile(save) {
  const bus = storageBus();
  if (save !== undefined) bus.map.set(KEY, typeof save === 'string' ? save : JSON.stringify(save));
  return bus;
}
const tab = (bus) => makeWorld({ bus });
const stored = (bus) => JSON.parse(bus.map.get(KEY));
const finishRun = (w) => { w.startAndRelease(); w.dieNow(); };
/** Another tab (or tool) sets the stored balance; open tabs hear about it when `flush` is true. */
function setGems(bus, gems, flush = true) {
  const s = stored(bus);
  bus.write(KEY, JSON.stringify({ ...s, gems, rev: s.rev + 1 }));
  if (flush) bus.flush();
}
function toasts(w) {
  const shown = [];
  const toast = w.TS.UI.toast.bind(w.TS.UI);
  w.TS.UI.toast = (t) => { shown.push(t); toast(t); };
  return shown;
}
const button = (w) => w.TS.UI.el.revive;
const note = (w) => (w.TS.UI.el.saveNoteOver.hidden ? null : w.TS.UI.el.saveNoteOver.textContent);
/** Asserts the result card is still up, nothing was granted, and returns the toasts shown. */
function assertNoRevive(w) {
  assert.equal(w.G.mode, 'over', 'still on the result card');
  assert.equal(w.G.revived, false, 'no revive granted');
  assert.equal(w.TS.UI.el.over.hidden, false);
}

test('a revive the stored save can afford is charged once and granted', () => {
  // Arrange
  const bus = profile({ gems: 50 });
  const w = tab(bus);
  finishRun(w);
  const before = stored(bus);
  const shown = toasts(w);
  // Act
  w.TS.UI.handlers.onRevive();
  // Assert
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.revived, true);
  assert.equal(stored(bus).gems, before.gems - COST);
  assert.equal(stored(bus).rev, before.rev + 1);
  assert.equal(w.G.save.gems, before.gems - COST);
  assert.deepEqual(shown, []);
});

test('exactly 20 gems pays for a revive and leaves 0', () => {
  const bus = profile({ gems: 0 });
  const w = tab(bus);
  finishRun(w);
  setGems(bus, COST);
  assert.equal(button(w).disabled, false);
  assert.equal(button(w).textContent, 'Keep going · ◆ 20');
  w.TS.UI.handlers.onRevive();
  assert.equal(w.G.mode, 'ready');
  assert.equal(stored(bus).gems, 0);
});

test('19 gems: the button is disabled with an accurate label, and nothing is charged or granted', () => {
  // Arrange
  const bus = profile({ gems: 0 });
  const w = tab(bus);
  finishRun(w);
  setGems(bus, COST - 1);
  const raw = bus.map.get(KEY);
  const shown = toasts(w);
  // Assert: the label
  assert.equal(button(w).hidden, false);
  assert.equal(button(w).disabled, true);
  assert.equal(button(w).textContent, 'Keep going · need 1 more ◆');
  // Act: even if the handler runs anyway, the payment is refused
  w.TS.UI.handlers.onRevive();
  // Assert
  assertNoRevive(w);
  assert.equal(bus.map.get(KEY), raw, 'nothing written');
  assert.equal(w.G.save.gems, COST - 1);
  assert.deepEqual(shown, ['1 more gems to keep going']);
});

test('a stale tab that thinks it can pay is refused against the latest balance', () => {
  // Arrange: B has 40+ in memory; A spends 30 on a skin before B hears about it
  const bus = profile({ gems: 40 });
  const a = tab(bus);
  const b = tab(bus);
  finishRun(b);
  const earned = b.G.run.gems;
  assert.ok(earned < 10, 'precondition: the run left the balance below 20 after the purchase');
  a.TS.UI.handlers.onSkin('gum'); // 30
  const raw = bus.map.get(KEY);
  const shown = toasts(b);
  assert.ok(b.G.save.gems >= COST, 'B still shows the old balance');
  // Act
  b.TS.UI.handlers.onRevive();
  // Assert
  assertNoRevive(b);
  assert.equal(bus.map.get(KEY), raw, 'nothing charged');
  const latest = 10 + earned;
  assert.equal(b.G.save.gems, latest, 'B now shows the real balance');
  assert.equal(button(b).disabled, true);
  assert.equal(button(b).textContent, 'Keep going · need ' + (COST - latest) + ' more ◆');
  assert.match(b.TS.UI.el.overGems.textContent, new RegExp('you have ' + latest + '\\)'));
  assert.deepEqual(shown, [(COST - latest) + ' more gems to keep going']);
});

test('a stale tab that thinks it cannot pay still revives if the latest save can', () => {
  // Arrange: B has under 20 in memory; A saves 30 more before B receives the storage event
  const bus = profile({ gems: 0 });
  const a = tab(bus);
  const b = tab(bus);
  finishRun(b);
  const earned = b.G.run.gems;
  assert.ok(b.G.save.gems < COST, 'precondition: B believes it cannot pay');
  const wrote = a.TS.Store.apply([{ type: 'run', earned: 30, score: 0, gates: 0, counted: false }]);
  assert.equal(wrote.ok, true);
  assert.equal(bus.queue.length > 0, true, 'the event has not been delivered to B yet');
  // Act
  b.TS.UI.handlers.onRevive();
  // Assert: the authoritative check used the stored balance, not B's memory
  assert.equal(b.G.mode, 'ready');
  assert.equal(b.G.revived, true);
  assert.equal(stored(bus).gems, 30 + earned - COST);
  assert.equal(b.G.save.gems, 30 + earned - COST);
  bus.flush();
  assert.equal(a.G.save.gems, 30 + earned - COST, 'A catches up');
});

test('another tab raising the balance enables the button with the price', () => {
  const bus = profile({ gems: 0 });
  const w = tab(bus);
  finishRun(w);
  assert.ok(w.G.save.gems < COST);
  assert.equal(button(w).disabled, true);
  setGems(bus, 25);
  assert.equal(button(w).disabled, false);
  assert.equal(button(w).textContent, 'Keep going · ◆ 20');
  setGems(bus, 3);
  assert.equal(button(w).textContent, 'Keep going · need 17 more ◆');
});

test('a revive whose payment cannot be saved charges nothing, grants nothing and says so', () => {
  // Arrange
  const bus = profile({ gems: 50 });
  const w = tab(bus);
  finishRun(w);
  const raw = bus.map.get(KEY);
  const gems = w.G.save.gems;
  const shown = toasts(w);
  w.ls.fail.set = QUOTA;
  // Act
  w.TS.UI.handlers.onRevive();
  // Assert
  assertNoRevive(w);
  assert.equal(bus.map.get(KEY), raw);
  assert.equal(w.G.save.gems, gems, 'not charged in memory either');
  assert.equal(shown[shown.length - 1], CANCELLED, 'the last word is the cancellation');
  assert.match(note(w), /isn't being saved/);
  // Storage works again: a new attempt is charged once
  w.ls.fail.set = null;
  w.TS.UI.handlers.onRevive();
  assert.equal(w.G.mode, 'ready');
  assert.equal(stored(bus).gems, gems - COST);
  assert.equal(note(w), null);
});

test('a failed revive payment never joins the unsaved queue', () => {
  const bus = profile({ gems: 50 });
  const w = tab(bus);
  finishRun(w);
  const gems = stored(bus).gems;
  w.ls.fail.set = QUOTA;
  w.TS.UI.handlers.onRevive();
  w.TS.UI.handlers.onSound(); // queued
  w.ls.fail.set = null;
  w.TS.UI.handlers.onSound(); // saves the queue
  assert.equal(stored(bus).gems, gems, 'the cancelled revive is never charged later');
  assert.equal(stored(bus).muted, false);
  assertNoRevive(w);
});

test('queued progress is saved in the same write as the revive payment, once', () => {
  // Arrange: the run ends while storage is full, so it is queued
  const bus = profile({ gems: COST });
  const w = tab(bus);
  w.ls.fail.set = QUOTA;
  finishRun(w);
  const earned = w.G.run.gems;
  const rev = stored(bus).rev || 0; // the seeded save has no revision yet
  // Act: still failing, then working
  w.TS.UI.handlers.onRevive();
  assertNoRevive(w);
  w.ls.fail.set = null;
  w.TS.UI.handlers.onRevive();
  // Assert
  assert.equal(w.G.mode, 'ready');
  const s = stored(bus);
  assert.equal(s.gems, COST + earned - COST, 'the run counted once, the revive charged once');
  assert.equal(s.plays, 1);
  assert.equal(s.rev, rev + 1, 'one write');
  w.TS.UI.handlers.onSound();
  assert.equal(stored(bus).plays, 1, 'the queue was emptied');
});

test('blocked storage: no revive', () => {
  const w = makeWorld({ localStorage: () => { throw domError('SecurityError', 18); } });
  finishRun(w);
  w.G.save = { ...w.G.save, gems: 50 }; // whatever memory says
  const shown = toasts(w);
  w.TS.UI.handlers.onRevive();
  assertNoRevive(w);
  assert.equal(w.G.save.gems, 50);
  assert.equal(shown[shown.length - 1], CANCELLED);
});

test('a corrupt save this tab could not back up: no revive, nothing written', () => {
  const raw = '{"broken';
  const ls = fakeStorage(new Map([[KEY, raw], [BAK, 'older backup']]));
  const w = makeWorld({ localStorage: ls });
  finishRun(w);
  w.G.save = { ...w.G.save, gems: 50 };
  const shown = toasts(w);
  w.TS.UI.handlers.onRevive();
  assertNoRevive(w);
  assert.equal(ls.map.get(KEY), raw);
  assert.equal(ls.map.get(BAK), 'older backup');
  assert.equal(shown[shown.length - 1], CANCELLED);
});

test('a save damaged after startup: no revive, and the damaged notice shows', () => {
  const bus = profile({ gems: 50 });
  const w = tab(bus);
  finishRun(w);
  bus.map.set(KEY, '{"damaged'); // no event reaches this tab
  w.TS.UI.handlers.onRevive();
  assertNoRevive(w);
  assert.equal(bus.map.get(KEY), '{"damaged');
  assert.equal(note(w), DAMAGED);
});

test('a save that keeps changing (busy): no revive and no charge', () => {
  const bus = profile({ gems: 50 });
  const w = tab(bus);
  finishRun(w);
  let n = 0;
  w.ls.hooks.afterGet = (k) => {
    if (k === KEY) bus.map.set(KEY, JSON.stringify({ gems: 100, rev: 1000 + ++n }));
  };
  const shown = toasts(w);
  w.TS.UI.handlers.onRevive();
  w.ls.hooks.afterGet = null;
  assertNoRevive(w);
  assert.equal(stored(bus).gems, 100);
  assert.equal(shown[shown.length - 1], CANCELLED);
});

test('a double click charges once, and a run is revived at most once', () => {
  // Arrange
  const bus = profile({ gems: 100 });
  const w = tab(bus);
  finishRun(w);
  const gems = stored(bus).gems;
  // Act
  w.TS.UI.handlers.onRevive();
  w.TS.UI.handlers.onRevive();
  // Assert
  assert.equal(stored(bus).gems, gems - COST);
  // Resume and die again: no second revive
  w.down(4);
  w.wait(1500);
  w.up(4);
  w.dieNow();
  assert.equal(button(w).hidden, true);
  const after = stored(bus);
  w.TS.UI.handlers.onRevive();
  assert.equal(w.G.mode, 'over', 'no second revive');
  assert.deepEqual(stored(bus), after, 'and no second charge');
  assert.equal(after.plays, 1, 'a revived run counts as one play');
});

test('there is no ad-funded revive: no overlay, no "watch ad", nothing granted', async () => {
  // Arrange: too few gems
  const bus = profile({ gems: 0 });
  const w = tab(bus);
  finishRun(w);
  assert.ok(w.G.save.gems < COST);
  // Assert: no ad overlay anywhere
  assert.equal(w.TS.UI.el.ad, undefined);
  assert.equal(w.TS.Ads.placeholder, undefined);
  const ids = [];
  const walk = (el) => { ids.push(el.getAttribute('id')); el.children.forEach(walk); };
  walk(w.TS.UI.el.stage);
  assert.ok(!ids.includes('adph'));
  assert.doesNotMatch(button(w).textContent, /ad\b/i);
  // Act
  w.TS.UI.handlers.onRevive();
  // Assert: nothing granted, and nothing blocks input
  assertNoRevive(w);
  assert.equal(w.TS.UI.modalOpen(), false);
  assert.equal(await w.TS.Ads.rewarded(), false, 'reports unavailable');
  w.passLock();
  w.down(7);
  assert.equal(w.G.mode, 'play', 'a tap still starts the next run');
});

test('the shipped scripts and styles contain no fake ad flow or ad promise', () => {
  const files = ['js/services.js', 'js/ui.js', 'js/game.js', 'css/style.css', 'index.html'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const banned of [/watch ad/i, /ad break/i, /adph/, /rewarded ad plays/i, /Ads\.placeholder/, /\.rewarded\(/]) {
      assert.doesNotMatch(src, banned, `${f} still mentions ${banned}`);
    }
  }
});
