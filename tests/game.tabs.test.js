'use strict';
/*
 * Several open tabs of the game sharing one save. Each tab is a full stand-in browser (see
 * tests/helpers/world.js); storage events reach the other tabs only when bus.flush() runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorld, storageBus, domError } = require('./helpers/world.js');

const KEY = 'twin-snap-save-v1';
const BAK = KEY + '.bak';
const QUOTA = () => domError('QuotaExceededError', 22);
const DAMAGED = 'Your save data is damaged. This tab cannot safely update your progress.';

/** A browser profile, optionally with a save already in it. */
function profile(save) {
  const bus = storageBus();
  if (save !== undefined) bus.map.set(KEY, typeof save === 'string' ? save : JSON.stringify(save));
  return bus;
}
const tab = (bus) => makeWorld({ bus });
const stored = (bus) => JSON.parse(bus.map.get(KEY));
const finishRun = (w) => { w.startAndRelease(); w.dieNow(); };
function lastToast(w) {
  const shown = [];
  const toast = w.TS.UI.toast.bind(w.TS.UI);
  w.TS.UI.toast = (t) => { shown.push(t); toast(t); };
  return () => shown[shown.length - 1];
}
const note = (w) => (w.TS.UI.el.saveNoteMenu.hidden ? null : w.TS.UI.el.saveNoteMenu.textContent);

test("a purchase in one tab survives a stale tab's write, and both tabs catch up", () => {
  // Arrange
  const bus = profile({ gems: 100 });
  const a = tab(bus);
  const b = tab(bus);
  // Act: A buys; B, which has not heard about it yet, changes sound
  a.TS.UI.handlers.onSkin('gum');
  b.TS.UI.handlers.onSound();
  // Assert: both changes are stored
  assert.deepEqual({ gems: stored(bus).gems, owned: stored(bus).owned, muted: stored(bus).muted },
    { gems: 70, owned: ['classic', 'gum'], muted: true });
  // Both tabs catch up when the events arrive
  bus.flush();
  assert.equal(b.G.save.gems, 70);
  assert.ok(b.G.save.owned.includes('gum'));
  assert.equal(b.TS.UI.el.gems.textContent, '◆ 70');
  assert.equal(a.G.save.muted, true);
  assert.equal(a.TS.Sfx.muted, true);
  assert.equal(a.TS.UI.el.sound.textContent, 'Sound off');
});

test("a stale tab's run never lowers the best score, and its gems are added", () => {
  const bus = profile({ best: 0, gems: 10 });
  const b = tab(bus);
  bus.write(KEY, JSON.stringify({ best: 50, bestGates: 30, gems: 40, plays: 4, rev: 5 })); // another tab
  finishRun(b);
  const earned = b.G.run.gems;
  assert.equal(stored(bus).best, 50);
  assert.equal(stored(bus).bestGates, 30);
  assert.equal(stored(bus).gems, 40 + earned);
  assert.equal(stored(bus).plays, 5);
  assert.equal(b.G.overData.best, 50, 'the result card shows the real best');
});

test('a purchase is refused if another tab already spent the gems', () => {
  const bus = profile({ gems: 130 });
  const a = tab(bus);
  const b = tab(bus);
  const toast = lastToast(b);
  a.TS.UI.handlers.onSkin('kit'); // 120
  b.TS.UI.handlers.onSkins();
  b.TS.UI.handlers.onSkin('blox'); // 60: B still thinks it has 130
  assert.match(toast(), /^50 more gems to unlock Blox/);
  assert.equal(b.G.save.gems, 10, 'B now shows the real balance');
  assert.ok(b.G.save.owned.includes('kit'));
  assert.equal(stored(bus).gems, 10);
  assert.ok(!stored(bus).owned.includes('blox'), 'nothing granted');
});

test('the same skin bought in two tabs is charged once', () => {
  const bus = profile({ gems: 100 });
  const a = tab(bus);
  const b = tab(bus);
  const toast = lastToast(b);
  a.TS.UI.handlers.onSkin('gum');
  b.TS.UI.handlers.onSkin('gum');
  assert.equal(stored(bus).gems, 70);
  assert.match(toast(), /already unlocked/);
  assert.equal(b.G.skin.id, 'gum');
});

test('an open shop and the result card refresh when another tab saves', () => {
  // Shop
  const bus = profile({ gems: 100 });
  const a = tab(bus);
  const b = tab(bus);
  b.TS.UI.handlers.onSkins();
  a.TS.UI.handlers.onSkin('gum');
  bus.flush();
  // The stand-in DOM keeps old children when textContent is cleared: the newest button is shown.
  const gum = b.TS.UI.el.grid.children.findLast((el) => el.getAttribute('id') === 'skin-gum');
  assert.equal(gum.children[2].textContent, 'Wearing');
  assert.match(b.TS.UI.el.shopGems.textContent, /^◆ 70 /);
  // Result card
  const bus2 = profile({ gems: 100 });
  const c = tab(bus2);
  const d = tab(bus2);
  finishRun(d);
  c.TS.UI.handlers.onSkin('gum');
  bus2.flush();
  assert.equal(d.G.save.gems, stored(bus2).gems);
  assert.match(d.TS.UI.el.overGems.textContent, new RegExp('you have ' + stored(bus2).gems + '\\)'));
});

test('unsaved progress in a failing tab is saved later exactly once, on top of the other tab', () => {
  // Arrange
  const bus = profile({ gems: 5 });
  const a = tab(bus);
  const b = tab(bus);
  b.ls.fail.set = QUOTA;
  finishRun(b); // queued: one run
  const earned = b.G.run.gems;
  b.TS.UI.handlers.onSound(); // queued: muted true
  b.TS.UI.handlers.onSound(); // queued: muted false
  a.TS.UI.handlers.onSound(); // A saves muted true
  bus.flush(); // B retries once and still fails
  assert.equal(stored(bus).plays, 0, 'nothing from B yet');
  // Act: storage works again; A's next save prompts B to retry
  b.ls.fail.set = null;
  a.TS.UI.handlers.onSkin('classic');
  bus.flush();
  // Assert
  assert.equal(stored(bus).plays, 1, 'the run counted exactly once');
  assert.equal(stored(bus).gems, 5 + earned);
  assert.equal(stored(bus).muted, false, "B's last choice, applied after A's");
  assert.equal(note(b), null, 'the failure notice cleared');
  b.TS.UI.handlers.onSound();
  assert.equal(stored(bus).plays, 1, 'not replayed again');
});

test('queued progress survives repeated events exactly once; a failed purchase is never queued', () => {
  // Arrange: B's storage fails; it banks a 7-gem run, changes sound and tries to buy
  const bus = profile({ gems: 100 });
  const a = tab(bus);
  const b = tab(bus);
  b.ls.fail.set = QUOTA;
  b.startAndRelease();
  b.G.run.gems = 7;
  b.dieNow();
  b.TS.UI.handlers.onSound(); // muted true, queued
  b.TS.UI.handlers.onSkin('gum'); // paid: cancelled, never queued
  assert.ok(!b.G.save.owned.includes('gum'));
  // Act 1: several events while B still cannot save
  for (let i = 0; i < 3; i++) {
    a.TS.UI.handlers.onSkin('classic'); // A saves (wear: no other change)
    bus.flush();
    const s = stored(bus);
    assert.equal(s.plays, 0, `event ${i}: nothing from B saved yet`);
    assert.equal(b.G.save.plays, s.plays + 1, `event ${i}: B's run counted once in memory`);
    assert.equal(b.G.save.gems, s.gems + 7, `event ${i}: B's gems counted once in memory`);
    assert.equal(b.G.save.muted, true);
  }
  // Act 2: B's storage works again; the next event lets it save its queue
  b.ls.fail.set = null;
  a.TS.UI.handlers.onSkin('classic');
  bus.flush();
  // Assert: saved exactly once, and the cancelled purchase was not replayed
  const saved = stored(bus);
  assert.equal(saved.plays, 1);
  assert.equal(saved.gems, 107);
  assert.equal(saved.muted, true);
  assert.ok(!saved.owned.includes('gum'));
  assert.equal(note(b), null);
  // Act 3: more events; B's queue is empty, so it writes nothing more and nothing repeats
  const rev = saved.rev;
  for (let i = 0; i < 2; i++) {
    a.TS.UI.handlers.onSkin('classic');
    bus.flush();
  }
  assert.equal(stored(bus).rev, rev + 2, 'only A wrote');
  assert.equal(stored(bus).plays, 1);
  assert.equal(stored(bus).gems, 107);
  assert.equal(b.G.save.gems, 107);
});

test('a deleted save reads as defaults; damaged data from outside is ignored and never overwritten', () => {
  // Deleted
  const bus = profile({ gems: 40, best: 9 });
  const b = tab(bus);
  bus.remove(KEY);
  bus.flush();
  assert.equal(b.G.save.gems, 0);
  assert.equal(b.G.save.best, 0);
  assert.equal(b.TS.UI.el.gems.textContent, '◆ 0');
  // Damaged
  const bus2 = profile({ gems: 40 });
  const c = tab(bus2);
  bus2.write(KEY, '{bad');
  bus2.flush();
  assert.equal(c.G.save.gems, 40, 'kept what it had');
  c.TS.UI.handlers.onSound();
  assert.equal(bus2.map.get(KEY), '{bad', 'not replaced');
  assert.equal(note(c), DAMAGED);
});

test('a save damaged in another tab gets its own notice until a valid save returns', () => {
  // Arrange
  const bus = profile({ gems: 40 });
  const a = tab(bus);
  const b = tab(bus);
  const toast = lastToast(b);
  // Act: something outside the game damages the save
  bus.write(KEY, '{"gems": 4');
  bus.flush();
  // Assert: told at once, in its own words, not as full or blocked storage
  assert.equal(note(b), DAMAGED);
  assert.equal(toast(), DAMAGED);
  assert.doesNotMatch(note(b), /full|blocked/);
  // B keeps playing; nothing it does overwrites the damaged data
  finishRun(b);
  b.TS.UI.handlers.onSound();
  assert.equal(bus.map.get(KEY), '{"gems": 4');
  assert.equal(b.TS.UI.el.saveNoteOver.textContent, DAMAGED);
  // A valid save comes back (for example the player restores it): the notice clears and B's
  // queued progress is saved on top
  bus.write(KEY, JSON.stringify({ gems: 100 }));
  bus.flush();
  assert.equal(note(b), null);
  assert.equal(stored(bus).plays, 1);
  assert.equal(stored(bus).muted, true);
  assert.equal(a.G.save.muted, true, 'and the other tab catches up');
});

test("storage events are re-read, never trusted, and other keys are ignored", () => {
  const bus = profile({ gems: 1 });
  const b = tab(bus);
  bus.map.set(KEY, JSON.stringify({ gems: 33 }));
  bus.send({ key: KEY, oldValue: null, newValue: JSON.stringify({ gems: 999 }), storageArea: null });
  assert.equal(b.G.save.gems, 33, 'the stored save, not the event text');
  bus.map.set(KEY, JSON.stringify({ gems: 44 }));
  bus.send({ key: 'something-else', oldValue: null, newValue: 'x', storageArea: null });
  assert.equal(b.G.save.gems, 33);
});

test('a save written by an older build is adopted, including the skin and sound', () => {
  const bus = profile({ gems: 1 });
  const b = tab(bus);
  bus.write(KEY, JSON.stringify({ best: 5, gems: 40, owned: ['classic', 'blox'], skin: 'blox', muted: true, plays: 3 }));
  bus.flush();
  assert.equal(b.G.save.gems, 40);
  assert.equal(b.G.skin.id, 'blox');
  assert.equal(b.TS.Sfx.muted, true);
  assert.equal(b.TS.UI.el.sound.textContent, 'Sound off');
});

test('a protected tab saves again once another tab has safely replaced the damaged save', () => {
  // Arrange: A recovers (writes the backup); B opens on top of that backup and is protected
  const raw = '{"broken';
  const bus = profile(raw);
  const a = tab(bus);
  const b = tab(bus);
  assert.match(note(b), /couldn't be backed up/);
  b.TS.UI.handlers.onSound(); // queued: muted true
  b.TS.UI.handlers.onSound(); // queued: muted false
  // Act: A saves a valid save
  a.TS.UI.handlers.onSound(); // muted true
  bus.flush();
  // Assert
  assert.equal(note(b), null, 'protection lifted');
  assert.equal(stored(bus).muted, false, "B's queued changes saved after A's");
  assert.equal(bus.map.get(BAK), raw, 'backup untouched');
});

test('a skin changed in another tab shows from the next run, not in the middle of one', () => {
  // Arrange: B is mid-run with the classic skin
  const bus = profile({ gems: 100, owned: ['classic', 'gum'], skin: 'classic' });
  const a = tab(bus);
  const b = tab(bus);
  b.startAndRelease();
  b.tick(5);
  assert.equal(b.G.mode, 'play');
  // Act: A switches to Bubblegum
  a.TS.UI.handlers.onSkins();
  a.TS.UI.handlers.onSkin('gum');
  bus.flush();
  // Assert: B's saved preference follows, the run keeps its skin
  assert.equal(b.G.save.skin, 'gum');
  assert.equal(b.G.skin.id, 'classic', 'unchanged during the run');
  b.blur();
  b.TS.UI.handlers.onSound(); // a save from the paused screen keeps it too
  assert.equal(b.G.skin.id, 'classic');
  b.down(1);
  b.up(1);
  b.wait(1500);
  b.dieNow();
  assert.equal(b.G.skin.id, 'classic', 'still this run on the result card');
  // The next run uses it
  b.TS.UI.handlers.onRetry();
  assert.equal(b.G.skin.id, 'gum');
  // On the title screen (no run) the change shows at once
  const c = tab(bus);
  a.TS.UI.handlers.onSkin('classic');
  bus.flush();
  assert.equal(c.G.mode, 'menu');
  assert.equal(c.G.skin.id, 'classic');
});

test('the revive deduction uses the latest balance (revive rules otherwise unchanged)', () => {
  const bus = profile({ gems: 100 });
  const a = tab(bus);
  const b = tab(bus);
  finishRun(b);
  const earned = b.G.run.gems;
  a.TS.UI.handlers.onSkin('blox'); // 60, from a tab that has not seen B's run
  b.TS.UI.handlers.onRevive();
  assert.equal(b.G.mode, 'ready', 'revive granted as before');
  assert.equal(stored(bus).gems, 100 + earned - 60 - 20);
});
