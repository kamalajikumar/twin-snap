'use strict';
/*
 * Save storage (js/services.js Store): load status, write status, corrupt-save backup and
 * failure injection. services.js runs in a sandbox with a fake localStorage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT, fakeStorage, domError, blockStorage } = require('./helpers/world.js');

const KEY = 'twin-snap-save-v1';
const BAK = KEY + '.bak';
const SRC = fs.readFileSync(path.join(ROOT, 'js/services.js'), 'utf8');

/** Loads a fresh copy of services.js; `ls` is a fakeStorage() or a throwing getter. */
function loadStore(ls) {
  const ctx = { navigator: {} };
  if (typeof ls !== 'function') ctx.localStorage = ls;
  ctx.self = ctx;
  vm.createContext(ctx);
  if (typeof ls === 'function') blockStorage(ctx, ls);
  vm.runInContext(SRC, ctx, { filename: 'js/services.js' });
  return ctx.TS.Store;
}

const QUOTA = () => domError('QuotaExceededError', 22);
const only = (key, err) => (k) => (k === key ? err() : null);
const plain = (o) => JSON.parse(JSON.stringify(o));
const OLD_SAVE = JSON.stringify({ best: 41, gems: 33, owned: ['classic', 'gum'], skin: 'gum', muted: true, plays: 9 });

test('the save, backup and probe keys are distinct, and the save key is unchanged', () => {
  const { save, backup, probe } = loadStore(fakeStorage()).KEYS;
  assert.equal(save, KEY);
  assert.equal(backup, BAK);
  assert.ok(probe !== save && probe !== backup);
});

test('a first visit starts from defaults and leaves nothing behind', () => {
  const ls = fakeStorage();
  const r = loadStore(ls).open();
  assert.equal(r.status, 'new');
  assert.deepEqual(plain(r.save), { best: 0, bestGates: 0, gems: 0, owned: ['classic'], skin: 'classic', muted: false, plays: 0 });
  assert.equal(ls.map.size, 0, 'probe key removed');
});

test('an existing save loads unchanged, and opening never rewrites it', () => {
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  const r = loadStore(ls).open();
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.save), { ...JSON.parse(OLD_SAVE), bestGates: 0 });
  assert.equal(ls.map.get(KEY), OLD_SAVE, 'raw save untouched');
  assert.deepEqual([...ls.map.keys()], [KEY]);
});

test('odd field values in a valid object are repaired, not treated as corrupt', () => {
  const raw = JSON.stringify({ best: 'x', gems: -5, owned: 'no', skin: 'zzz', muted: 'yes', plays: 2.7 });
  const r = loadStore(fakeStorage(new Map([[KEY, raw]]))).open();
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.save), { best: 0, bestGates: 0, gems: 0, owned: ['classic'], skin: 'classic', muted: false, plays: 2 });
});

test('blocked storage loads defaults as unavailable, and writes report unavailable', () => {
  // getItem throws
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  ls.fail.get = () => domError('SecurityError', 18);
  ls.fail.set = () => domError('SecurityError', 18);
  const store = loadStore(ls);
  assert.equal(store.open().status, 'unavailable');
  const w = store.write(store.open().save, { gems: 5 });
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'unavailable');
  assert.equal(w.save.gems, 5, 'the unsaved result is still returned for in-memory use');
  assert.equal(ls.map.get(KEY), OLD_SAVE);
  // window.localStorage itself throws
  const blocked = loadStore(() => { throw domError('SecurityError', 18); });
  const r = blocked.open();
  assert.equal(r.status, 'unavailable');
  assert.equal(r.save.gems, 0);
  assert.equal(blocked.write(r.save, { gems: 1 }).reason, 'unavailable');
});

test('storage that cannot be written at startup is readonly, keeps the save and allows later writes', () => {
  // Arrange: readable, but every write fails (full storage)
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  ls.fail.set = QUOTA;
  const store = loadStore(ls);
  // Act
  const r = store.open();
  // Assert
  assert.equal(r.status, 'readonly');
  assert.equal(r.reason, 'quota');
  assert.equal(r.save.gems, 33);
  assert.deepEqual([...ls.map.keys()], [KEY], 'no probe left behind');
  // Two failed writes accumulate in memory; the next successful one saves all of it
  const a = store.write(r.save, { gems: 40 });
  const b = store.write(a.save, { best: 90 });
  assert.equal(a.ok || b.ok, false);
  ls.fail.set = null;
  const c = store.write(b.save, { muted: false });
  assert.equal(c.ok, true);
  assert.deepEqual(JSON.parse(ls.map.get(KEY)), plain(c.save));
  assert.equal(c.save.gems, 40);
  assert.equal(c.save.best, 90);
});

test('a probe that cannot be removed is reported and removed by the next write', () => {
  // Arrange
  const ls = fakeStorage();
  ls.fail.remove = () => domError('UnknownError', 0);
  const store = loadStore(ls);
  // Act
  const r = store.open();
  // Assert
  assert.equal(r.status, 'new');
  assert.equal(r.probe, 'left');
  assert.ok(ls.map.has(store.KEYS.probe), 'precondition: probe is still there');
  const stuck = store.write(r.save, { gems: 1 });
  assert.equal(stuck.ok, true);
  assert.equal(stuck.probe, 'left', 'still reported while removal keeps failing');
  ls.fail.remove = null;
  const w = store.write(stuck.save, { gems: 2 });
  assert.equal(w.ok, true);
  assert.equal(w.probe, undefined);
  assert.ok(!ls.map.has(store.KEYS.probe), 'probe removed');
  assert.deepEqual([...ls.map.keys()], [KEY]);
});

test('a corrupt save is backed up byte for byte before anything replaces it', () => {
  for (const raw of ['{"best": 77, "gems": 4', '42', '[1,2]', 'null', '"text"', '']) {
    // Arrange
    const ls = fakeStorage(new Map([[KEY, raw]]));
    const store = loadStore(ls);
    // Act
    const r = store.open();
    // Assert
    assert.equal(r.status, 'corrupt-recovered', JSON.stringify(raw));
    assert.equal(ls.map.get(BAK), raw, 'backup is exact');
    assert.equal(ls.map.get(KEY), raw, 'original not touched by opening');
    assert.equal(r.save.best, 0);
    const w = store.write(r.save, { gems: 3 });
    assert.equal(w.ok, true);
    assert.equal(JSON.parse(ls.map.get(KEY)).gems, 3, 'later writes replace the corrupt original');
    assert.equal(ls.map.get(BAK), raw, 'backup kept');
  }
});

test('if the backup cannot be made, the corrupt original is never overwritten this session', () => {
  const raw = '{"best": 77, "gems": 4';
  // Backup write throws
  const a = fakeStorage(new Map([[KEY, raw]]));
  a.fail.set = only(BAK, QUOTA);
  const storeA = loadStore(a);
  const ra = storeA.open();
  assert.equal(ra.status, 'corrupt-protected');
  for (const patch of [{ gems: 1 }, { muted: true }]) {
    const w = storeA.write(ra.save, patch);
    assert.equal(w.ok, false);
    assert.equal(w.reason, 'protected');
  }
  a.fail.set = null; // even once storage works again
  assert.equal(storeA.write(ra.save, { gems: 2 }).reason, 'protected');
  assert.equal(a.map.get(KEY), raw);
  // Backup reads back different: our bad copy is removed, the original kept
  const b = fakeStorage(new Map([[KEY, raw]]));
  const set = b.setItem;
  b.setItem = (k, v) => set(k, k === BAK ? v.slice(0, 3) : v);
  const rb = loadStore(b).open();
  assert.equal(rb.status, 'corrupt-protected');
  assert.equal(b.map.get(KEY), raw);
  assert.ok(!b.map.has(BAK), 'unverified backup removed');
});

test('any existing backup, even an identical one, means protected: neither file is ever overwritten', () => {
  const raw = '{"broken';
  for (const existing of ['older backup', raw]) {
    // Arrange
    const ls = fakeStorage(new Map([[KEY, raw], [BAK, existing]]));
    const store = loadStore(ls);
    // Act
    const r = store.open();
    // Assert
    assert.equal(r.status, 'corrupt-protected', `existing backup ${JSON.stringify(existing)}`);
    for (const patch of [{ gems: 1 }, { muted: true }, { owned: ['classic', 'gum'] }]) {
      const w = store.write(r.save, patch);
      assert.equal(w.ok, false);
      assert.equal(w.reason, 'protected');
    }
    assert.equal(ls.map.get(KEY), raw, 'corrupt original byte-identical');
    assert.equal(ls.map.get(BAK), existing, 'existing backup byte-identical');
  }
});

test('a corrupt save that is backed up while the startup write test fails reports both', () => {
  // Arrange: the backup can be written, the probe cannot
  const raw = '{"broken';
  const ls = fakeStorage(new Map([[KEY, raw]]));
  const store = loadStore(ls);
  ls.fail.set = only(store.KEYS.probe, QUOTA);
  // Act
  const r = store.open();
  // Assert
  assert.equal(r.status, 'corrupt-recovered');
  assert.equal(r.reason, 'quota', 'the failed write test is reported too');
  assert.equal(ls.map.get(BAK), raw);
  ls.fail.set = null;
  assert.equal(store.write(r.save, { gems: 1 }).ok, true, 'later writes are still attempted');
});

test('a corrupt save on storage that refuses every write is protected', () => {
  const raw = '{"broken';
  const ls = fakeStorage(new Map([[KEY, raw]]));
  ls.fail.set = () => domError('SecurityError', 18);
  const store = loadStore(ls);
  const r = store.open();
  assert.equal(r.status, 'corrupt-protected');
  ls.fail.set = null;
  assert.equal(store.write(r.save, { gems: 1 }).reason, 'protected');
  assert.equal(ls.map.get(KEY), raw);
  assert.ok(!ls.map.has(BAK));
});

test('a successful write is persisted, reported and never mutates its input', () => {
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  const store = loadStore(ls);
  const before = Object.freeze(store.open().save);
  const w = store.write(before, { gems: 50, owned: before.owned.concat('blox') });
  assert.equal(w.ok, true);
  assert.equal(w.reason, undefined);
  assert.notEqual(w.save, before);
  assert.equal(before.gems, 33);
  assert.deepEqual(JSON.parse(ls.map.get(KEY)), plain(w.save));
  assert.deepEqual(plain(w.save.owned), ['classic', 'gum', 'blox']);
});

test('write failures are classified and leave storage untouched', () => {
  const cases = [
    [() => domError('QuotaExceededError', 22), 'quota'],
    [() => domError('Error', 22), 'quota'],
    [() => domError('NS_ERROR_DOM_QUOTA_REACHED', 1014), 'quota'],
    [() => domError('SecurityError', 18), 'unavailable'],
    [() => new TypeError('boom'), 'error'],
  ];
  for (const [err, reason] of cases) {
    const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
    const store = loadStore(ls);
    const r = store.open();
    ls.fail.set = err;
    const w = store.write(r.save, { gems: 99 });
    assert.equal(w.ok, false, reason);
    assert.equal(w.reason, reason);
    assert.equal(w.save.gems, 99);
    assert.equal(ls.map.get(KEY), OLD_SAVE);
  }
});
