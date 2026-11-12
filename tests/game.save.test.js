'use strict';
/*
 * Save transparency in the running game: what the player sees and what is kept when storage
 * fails, is blocked or holds a corrupt save. Uses the stand-in browser from tests/helpers/world.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorld, fakeStorage, domError } = require('./helpers/world.js');

const KEY = 'twin-snap-save-v1';
const BAK = KEY + '.bak';
const QUOTA = () => domError('QuotaExceededError', 22);
const saved = (ls) => JSON.parse(ls.map.get(KEY));

/** Both save-status lines (title and result card) and how many toasts were shown. */
function watch(w) {
  const toasts = [];
  const toast = w.TS.UI.toast.bind(w.TS.UI);
  w.TS.UI.toast = (text) => { toasts.push(text); toast(text); };
  const note = () => {
    const { saveNoteMenu: m, saveNoteOver: o } = w.TS.UI.el;
    assert.equal(m.hidden, o.hidden, 'both save notes agree');
    assert.equal(m.textContent, o.textContent);
    return m.hidden ? null : m.textContent;
  };
  return { toasts, note };
}

function finishRun(w) {
  w.startAndRelease();
  w.dieNow();
}

test('with healthy storage there is no save notice and progress is saved', () => {
  const ls = fakeStorage();
  const w = makeWorld({ localStorage: ls });
  const { note, toasts } = watch(w);
  assert.equal(note(), null);
  finishRun(w);
  assert.equal(note(), null);
  assert.equal(toasts.length, 0);
  assert.equal(saved(ls).plays, 1);
});

test('when a write fails, progress stays in memory, the notice shows and one toast warns', () => {
  // Arrange
  const ls = fakeStorage();
  const w = makeWorld({ localStorage: ls });
  const { note, toasts } = watch(w);
  w.G.save = { ...w.G.save, best: 0 };
  ls.fail.set = QUOTA;
  // Act: two runs end while storage is full
  finishRun(w);
  const afterFirst = { ...w.G.save };
  w.TS.UI.handlers.onRetry();
  w.dieNow();
  // Assert
  assert.equal(w.G.save.plays, 2, 'in-memory progress kept');
  assert.equal(afterFirst.plays, 1);
  assert.ok(!ls.map.has(KEY), 'nothing was saved');
  assert.match(note(), /isn't being saved/);
  assert.equal(toasts.length, 1, 'warned once, not on every failure');
});

test('when storage works again, the next save stores the accumulated progress and clears the notice', () => {
  const ls = fakeStorage();
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  ls.fail.set = QUOTA;
  finishRun(w);
  w.TS.UI.handlers.onSound(); // also unsaved
  assert.match(note(), /isn't being saved/);
  // Act
  ls.fail.set = null;
  w.TS.UI.handlers.onSound();
  w.TS.UI.handlers.onSound();
  // Assert
  assert.equal(note(), null);
  assert.equal(saved(ls).plays, 1, 'the run that ended while storage was full is saved now');
  assert.equal(saved(ls).muted, true);
});

test('a skin purchase that cannot be saved changes nothing and says so', () => {
  // Arrange: 100 gems saved (purchases are checked against the stored save, so it must be stored)
  const ls = fakeStorage(new Map([[KEY, JSON.stringify({ gems: 100 })]]));
  const w = makeWorld({ localStorage: ls });
  const { toasts } = watch(w);
  const before = w.G.save;
  const snapshot = JSON.stringify(before);
  const raw = ls.map.get(KEY);
  ls.fail.set = QUOTA;
  // Act
  w.TS.UI.handlers.onSkins();
  w.TS.UI.handlers.onSkin('gum');
  // Assert
  assert.equal(w.G.save, before, 'the in-memory save object was not replaced');
  assert.equal(JSON.stringify(w.G.save), snapshot, 'and not mutated');
  assert.equal(w.G.save.gems, 100);
  assert.ok(!w.G.save.owned.includes('gum'));
  assert.equal(w.G.skin.id, 'classic');
  assert.equal(ls.map.get(KEY), raw, 'storage unchanged');
  assert.match(toasts[toasts.length - 1], /purchase was cancelled/);
});

test('a skin purchase that saves deducts gems and grants the skin', () => {
  const ls = fakeStorage(new Map([[KEY, JSON.stringify({ gems: 100 })]]));
  const w = makeWorld({ localStorage: ls });
  w.TS.UI.handlers.onSkin('gum');
  assert.equal(w.G.save.gems, 70);
  assert.equal(w.G.skin.id, 'gum');
  assert.deepEqual(saved(ls).owned, ['classic', 'gum']);
  assert.equal(saved(ls).gems, 70);
});

test('wearing an owned skin and the sound setting still apply in memory when saving fails', () => {
  const ls = fakeStorage(new Map([[KEY, JSON.stringify({ owned: ['classic', 'gum'], skin: 'classic' })]]));
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  ls.fail.set = QUOTA;
  w.TS.UI.handlers.onSkin('gum');
  w.TS.UI.handlers.onSound();
  assert.equal(w.G.skin.id, 'gum');
  assert.equal(w.G.save.muted, true);
  assert.equal(w.TS.Sfx.muted, true);
  assert.equal(w.TS.UI.el.sound.textContent, 'Sound off');
  assert.match(note(), /isn't being saved/);
  assert.equal(saved(ls).skin, 'classic');
});

test('a corrupt save is backed up, reported and the game still plays', () => {
  const raw = '{"best": 77, "gems": 4';
  const ls = fakeStorage(new Map([[KEY, raw]]));
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  assert.equal(ls.map.get(BAK), raw);
  assert.match(note(), /damaged\. A copy was kept/);
  finishRun(w);
  assert.equal(w.G.mode, 'over');
  assert.equal(saved(ls).plays, 1, 'a fresh save replaces the corrupt one once it is backed up');
  assert.equal(ls.map.get(BAK), raw);
  assert.match(note(), /damaged\. A copy was kept/, 'the explanation stays for this session');
});

test('a corrupt save that cannot be backed up is never overwritten', () => {
  const raw = '{"best": 77, "gems": 4';
  const ls = fakeStorage(new Map([[KEY, raw]]));
  ls.fail.set = (k) => (k === BAK ? QUOTA() : null);
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  assert.match(note(), /couldn't be backed up/);
  finishRun(w);
  w.TS.UI.handlers.onSound();
  w.G.save = { ...w.G.save, gems: 100 };
  w.TS.UI.handlers.onSkin('gum');
  assert.equal(ls.map.get(KEY), raw, 'original byte-identical');
  assert.ok(!w.G.save.owned.includes('gum'), 'a purchase that cannot be saved is refused');
  assert.match(note(), /couldn't be backed up/);
});

test('an existing backup protects both files for the whole session', () => {
  const raw = '{"best": 77, "gems": 4';
  const ls = fakeStorage(new Map([[KEY, raw], [BAK, raw]]));
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  assert.match(note(), /couldn't be backed up/);
  finishRun(w);
  w.TS.UI.handlers.onSound();
  assert.equal(ls.map.get(KEY), raw);
  assert.equal(ls.map.get(BAK), raw);
});

test('corrupt and recovered while the startup write test fails: both are reported', () => {
  // Arrange: the backup works, every other write fails
  const raw = '{"broken';
  const ls = fakeStorage(new Map([[KEY, raw]]));
  ls.fail.set = (k) => (k === BAK ? null : QUOTA());
  // Act
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  // Assert: storage failure first, then the recovery
  assert.equal(ls.map.get(BAK), raw);
  assert.match(note(), /^Progress isn't being saved.*Your save was damaged\. A copy was kept/);
  // A later successful save clears only the storage failure
  ls.fail.set = null;
  finishRun(w);
  assert.match(note(), /^Your save was damaged\. A copy was kept/);
  assert.doesNotMatch(note(), /isn't being saved/);
});

test('notice priority: protected, then a current failure, then recovered, then nothing', () => {
  // Recovered, then a write failure, then a success
  const ls = fakeStorage(new Map([[KEY, '{"broken']]));
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  assert.match(note(), /^Your save was damaged/);
  ls.fail.set = QUOTA;
  w.TS.UI.handlers.onSound();
  assert.match(note(), /^Progress isn't being saved.*damaged/);
  ls.fail.set = null;
  w.TS.UI.handlers.onSound();
  assert.match(note(), /^Your save was damaged/, 'success clears the failure, not the recovery');
  // Protected beats a failing store: only the protected message
  const p = fakeStorage(new Map([[KEY, '{"broken']]));
  p.fail.set = () => domError('SecurityError', 18);
  const wp = makeWorld({ localStorage: p });
  const np = watch(wp).note;
  assert.match(np(), /^Your save is damaged and couldn't be backed up/);
  wp.TS.UI.handlers.onSound();
  assert.match(np(), /^Your save is damaged and couldn't be backed up/);
  assert.equal(p.map.get(KEY), '{"broken');
  // Healthy storage: nothing
  const h = makeWorld({ localStorage: fakeStorage() });
  assert.equal(watch(h).note(), null);
});

test('blocked storage is reported on the title and the game still plays', () => {
  const w = makeWorld({ localStorage: () => { throw domError('SecurityError', 18); } });
  const { note } = watch(w);
  assert.match(note(), /can't be saved in this browser mode/);
  w.TS.UI.handlers.onSound();
  assert.equal(w.G.save.muted, true);
  finishRun(w);
  assert.equal(w.G.mode, 'over');
});

test('storage that is read-only at startup is reported, and a later successful save clears it', () => {
  const ls = fakeStorage(new Map([[KEY, JSON.stringify({ best: 12, gems: 5 })]]));
  ls.fail.set = QUOTA;
  const w = makeWorld({ localStorage: ls });
  const { note } = watch(w);
  assert.equal(w.G.save.best, 12, 'existing progress loaded');
  assert.match(note(), /isn't being saved/);
  ls.fail.set = null;
  finishRun(w);
  assert.equal(note(), null);
  assert.equal(saved(ls).plays, 1);
  assert.equal(saved(ls).gems >= 5, true);
});
