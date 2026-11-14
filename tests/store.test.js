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
/** Simple changes for the storage tests: gain gems, set sound, raise the best score. */
const gain = (n) => ({ type: 'run', earned: n, score: 0, gates: 0, counted: false });
const sound = (value) => ({ type: 'muted', value });
const bestOf = (score) => ({ type: 'run', earned: 0, score, gates: 0, counted: false });
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
  assert.deepEqual(plain(r.save), { best: 0, bestGates: 0, gems: 0, owned: ['classic'], skin: 'classic', muted: false, plays: 0, rev: 0 });
  assert.equal(ls.map.size, 0, 'probe key removed');
});

test('an existing save loads unchanged, and opening never rewrites it', () => {
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  const r = loadStore(ls).open();
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.save), { ...JSON.parse(OLD_SAVE), bestGates: 0, rev: 0 });
  assert.equal(ls.map.get(KEY), OLD_SAVE, 'raw save untouched');
  assert.deepEqual([...ls.map.keys()], [KEY]);
});

test('odd field values in a valid object are repaired, not treated as corrupt', () => {
  const raw = JSON.stringify({ best: 'x', gems: -5, owned: 'no', skin: 'zzz', muted: 'yes', plays: 2.7 });
  const r = loadStore(fakeStorage(new Map([[KEY, raw]]))).open();
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.save), { best: 0, bestGates: 0, gems: 0, owned: ['classic'], skin: 'classic', muted: false, plays: 2, rev: 0 });
});

test('blocked storage loads defaults as unavailable, and writes report unavailable', () => {
  // getItem throws
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  ls.fail.get = () => domError('SecurityError', 18);
  ls.fail.set = () => domError('SecurityError', 18);
  const store = loadStore(ls);
  assert.equal(store.open().status, 'unavailable');
  const w = store.apply([gain(5)]);
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'unavailable');
  assert.equal(w.save, undefined, 'nothing is reported as saved');
  assert.equal(ls.map.get(KEY), OLD_SAVE);
  // window.localStorage itself throws
  const blocked = loadStore(() => { throw domError('SecurityError', 18); });
  const r = blocked.open();
  assert.equal(r.status, 'unavailable');
  assert.equal(r.save.gems, 0);
  assert.equal(blocked.apply([gain(1)]).reason, 'unavailable');
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
  // Two failed attempts; the caller keeps the changes and the next successful apply saves all
  const a = store.apply([gain(7)]);
  const b = store.apply([gain(7), bestOf(90)]);
  assert.equal(a.ok || b.ok, false);
  assert.equal(ls.map.get(KEY), OLD_SAVE);
  ls.fail.set = null;
  const c = store.apply([gain(7), bestOf(90), sound(false)]);
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
  const stuck = store.apply([gain(1)]);
  assert.equal(stuck.ok, true);
  assert.equal(stuck.probe, 'left', 'still reported while removal keeps failing');
  ls.fail.remove = null;
  const w = store.apply([gain(1)]);
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
    const w = store.apply([gain(3)]);
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
  for (const c of [gain(1), sound(true)]) {
    const w = storeA.apply([c]);
    assert.equal(w.ok, false);
    assert.equal(w.reason, 'protected');
  }
  a.fail.set = null; // even once storage works again
  assert.equal(storeA.apply([gain(2)]).reason, 'protected');
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
    for (const c of [gain(1), sound(true), { type: 'buy', id: 'gum', cost: 0 }]) {
      const w = store.apply([c]);
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
  assert.equal(store.apply([gain(1)]).ok, true, 'later writes are still attempted');
});

test('a corrupt save on storage that refuses every write is protected', () => {
  const raw = '{"broken';
  const ls = fakeStorage(new Map([[KEY, raw]]));
  ls.fail.set = () => domError('SecurityError', 18);
  const store = loadStore(ls);
  const r = store.open();
  assert.equal(r.status, 'corrupt-protected');
  ls.fail.set = null;
  assert.equal(store.apply([gain(1)]).reason, 'protected');
  assert.equal(ls.map.get(KEY), raw);
  assert.ok(!ls.map.has(BAK));
});

test('a successful apply is persisted, reported and never mutates its input', () => {
  const ls = fakeStorage(new Map([[KEY, OLD_SAVE]]));
  const store = loadStore(ls);
  const before = Object.freeze(store.open().save);
  const changes = Object.freeze([Object.freeze(gain(17)), Object.freeze({ type: 'buy', id: 'blox', cost: 0 })]);
  const w = store.apply(changes);
  assert.equal(w.ok, true);
  assert.equal(w.reason, undefined);
  assert.notEqual(w.save, before);
  assert.equal(before.gems, 33);
  assert.equal(w.save.gems, 50);
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
    store.open();
    ls.fail.set = err;
    const w = store.apply([gain(66)]);
    assert.equal(w.ok, false, reason);
    assert.equal(w.reason, reason);
    assert.equal(w.save, undefined, 'nothing is reported as saved');
    assert.equal(ls.map.get(KEY), OLD_SAVE);
  }
});

// ---------- cross-tab safety (M0.6b): revisions and changes applied to the latest save ----------

/** Two (or more) tabs: separate copies of services.js sharing one browser profile's storage. */
function tabs(initial, n = 2) {
  const map = new Map(initial ? [[KEY, typeof initial === 'string' ? initial : JSON.stringify(initial)]] : []);
  return Array.from({ length: n }, () => {
    const ls = fakeStorage(map);
    const store = loadStore(ls);
    return { ls, store, opened: store.open() };
  });
}
const stored = (t) => JSON.parse(t.ls.map.get(KEY));
const run = (earned, score = 0, gates = 0, counted = true) => ({ type: 'run', earned, score, gates, counted });
const buy = (id, cost) => ({ type: 'buy', id, cost });

test('a save without a revision reads as 0, and every applied write increases it', () => {
  const [a] = tabs(OLD_SAVE, 1);
  assert.equal(a.opened.save.rev, 0);
  assert.equal(a.store.apply([run(1)]).save.rev, 1);
  assert.equal(a.store.apply([{ type: 'muted', value: false }]).save.rev, 2);
  assert.equal(stored(a).rev, 2);
});

test('changes from two tabs are applied to the latest save, so neither is lost', () => {
  // Arrange: both tabs opened with 100 gems
  const [a, b] = tabs({ gems: 100 });
  // Act: A buys, then B (which never saw that) banks a run and changes sound
  assert.equal(a.store.apply([buy('gum', 30)]).ok, true);
  assert.equal(b.store.apply([run(5, 9, 4)]).ok, true);
  assert.equal(b.store.apply([{ type: 'muted', value: true }]).ok, true);
  // Assert
  assert.deepEqual(plain(stored(a)), { best: 9, bestGates: 4, gems: 75, owned: ['classic', 'gum'], skin: 'gum', muted: true, plays: 1, rev: 3 });
});

test('the best score and owned skins never go down', () => {
  const [a, b] = tabs({ best: 0, owned: ['classic'] });
  a.store.apply([run(0, 50, 30)]);
  b.store.apply([run(0, 3, 2)]);
  assert.equal(stored(a).best, 50);
  assert.equal(stored(a).bestGates, 30);
  b.store.apply([{ type: 'wear', id: 'gum' }]); // not owned: nothing changes
  assert.equal(stored(a).skin, 'classic');
});

test('a purchase is checked against the latest balance and ownership', () => {
  // Rejected: the other tab already spent the gems
  const [a, b] = tabs({ gems: 130 });
  a.store.apply([buy('kit', 120)]);
  const before = a.ls.map.get(KEY);
  const r = b.store.apply([buy('blox', 60)]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rejected');
  assert.equal(r.latest.gems, 10, 'the latest save is returned for refreshing');
  assert.equal(a.ls.map.get(KEY), before, 'nothing written');
  // Already bought in the other tab: worn, never charged twice
  const [c, d] = tabs({ gems: 100 });
  c.store.apply([buy('gum', 30)]);
  const again = d.store.apply([buy('gum', 30)]);
  assert.equal(again.ok, true);
  assert.deepEqual(plain(again.notes), ['already-owned']);
  assert.equal(stored(c).gems, 70);
});

test('queued changes are applied first, and the purchase is checked against the result', () => {
  // Enough only with the unsaved run's gems
  const [a] = tabs({ gems: 25 });
  const ok = a.store.apply([run(10, 0, 0, true), buy('gum', 30)]);
  assert.equal(ok.ok, true);
  assert.equal(stored(a).gems, 5);
  assert.equal(stored(a).plays, 1);
  // Not enough even with them: nothing at all is written, the queue is the caller's to keep
  const [b] = tabs({ gems: 20 });
  const before = b.ls.map.get(KEY);
  const no = b.store.apply([run(4), buy('gum', 30)]);
  assert.equal(no.reason, 'rejected');
  assert.equal(b.ls.map.get(KEY), before);
});

test('changes are plain data and replay deterministically without mutating anything', () => {
  const [a] = tabs(null, 1);
  const base = Object.freeze({ ...a.opened.save, gems: 40 });
  const changes = Object.freeze([run(5, 7, 3), run(5, 2, 1, false), { type: 'muted', value: true }, buy('gum', 30)]);
  const x = a.store.project(base, changes);
  const y = a.store.project(base, changes);
  assert.deepEqual(plain(x.save), plain(y.save));
  assert.equal(x.save.gems, 20);
  assert.equal(x.save.plays, 1);
  assert.equal(base.gems, 40);
  assert.deepEqual(plain(JSON.parse(JSON.stringify(changes))), plain(changes), 'serialisable');
});

test('a recovered tab may write over its own corrupt original, but never over unknown corrupt data', () => {
  // Own corrupt original (backed up this session): the first write replaces it
  const raw = '{"broken';
  const [a] = tabs(raw, 1);
  assert.equal(a.opened.status, 'corrupt-recovered');
  assert.equal(a.store.apply([run(2)]).ok, true);
  assert.equal(stored(a).gems, 2);
  // Some other corrupt text appears: refused, untouched
  a.ls.map.set(KEY, '{"other broken');
  const r = a.store.apply([run(1)]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(a.ls.map.get(KEY), '{"other broken');
});

test('a corrupt-protected tab never applies changes', () => {
  const [a] = tabs('{"broken', 1);
  a.ls.map.set(BAK, 'x'); // fresh tab on top of an existing backup
  const p = loadStore(a.ls);
  assert.equal(p.open().status, 'corrupt-protected');
  assert.equal(p.apply([run(1)]).reason, 'protected');
});

test('a save written by an older build without a revision is read and continued', () => {
  const [a] = tabs({ gems: 10 }, 1);
  a.store.apply([run(1)]);
  a.ls.map.set(KEY, JSON.stringify({ best: 5, gems: 40, owned: ['classic', 'blox'], skin: 'blox', muted: false, plays: 3 }));
  const r = a.store.apply([run(2)]);
  assert.equal(r.ok, true);
  assert.equal(stored(a).gems, 42);
  assert.deepEqual(stored(a).owned, ['classic', 'blox']);
  assert.equal(stored(a).rev, 1);
});

test('race detected before writing: another tab writes after our read, we re-read and keep both', () => {
  // Arrange: tab B writes right after tab A's first read
  const [a, b] = tabs({ gems: 10 });
  let reads = 0;
  a.ls.hooks.afterGet = (k) => {
    if (k === KEY && ++reads === 1) b.store.apply([run(5)]);
  };
  // Act
  const r = a.store.apply([run(100)]);
  // Assert
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2, 'the change was noticed and the write retried');
  assert.equal(stored(a).gems, 115, 'both changes kept');
});

test('unavoidable race after the final check: a write in between is lost (known limitation)', () => {
  // localStorage has no compare-and-swap. If another tab writes after our last re-read and
  // before our setItem, our write replaces it. This test documents that this can still happen.
  const [a, b] = tabs({ gems: 10 });
  let fired = false;
  a.ls.hooks.beforeSet = (k) => {
    if (k === KEY && !fired) {
      fired = true;
      b.store.apply([run(5)]);
    }
  };
  const r = a.store.apply([run(100)]);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(stored(a).gems, 110, "tab B's 5 gems were lost: the documented race");
});

test('if the save keeps changing on every attempt, nothing is written after three tries', () => {
  const [a, b] = tabs({ gems: 10 });
  a.ls.hooks.afterGet = (k) => { if (k === KEY) b.store.apply([run(1)]); };
  const r = a.store.apply([run(100)]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'busy');
  assert.equal(r.attempts, 3);
  assert.ok(stored(a).gems < 100, "our change was not written over the other tab's");
});

test('read() re-reads and validates the stored save', () => {
  const [a] = tabs({ gems: 7 }, 1);
  const ok = a.store.read();
  assert.equal(ok.ok, true);
  assert.equal(ok.save.gems, 7);
  a.ls.map.delete(KEY);
  const gone = a.store.read();
  assert.equal(gone.ok, true);
  assert.equal(gone.deleted, true);
  assert.equal(gone.save.gems, 0, 'a deleted save reads as defaults');
  a.ls.map.set(KEY, '{bad');
  const bad = a.store.read();
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'corrupt');
  a.ls.fail.get = () => domError('SecurityError', 18);
  assert.equal(a.store.read().reason, 'unavailable');
});

test('a protected tab lifts protection only when the backup matches the corrupt save it saw', () => {
  const raw = '{"broken';
  // Tab A recovers (writes the backup); tab B opens later and is protected by that backup
  const map = new Map([[KEY, raw]]);
  const a = loadStore(fakeStorage(map));
  assert.equal(a.open().status, 'corrupt-recovered');
  const bls = fakeStorage(map);
  const b = loadStore(bls);
  assert.equal(b.open().status, 'corrupt-protected');
  assert.equal(b.read().unprotected, undefined, 'still the corrupt original: stays protected');
  // A writes a valid save; the backup equals the corrupt text B saw: B may write again
  a.apply([run(3)]);
  const r = b.read();
  assert.equal(r.unprotected, true);
  assert.equal(b.apply([run(1)]).ok, true);
  assert.equal(JSON.parse(map.get(KEY)).gems, 4);
  assert.equal(map.get(BAK), raw, 'backup untouched');
  // A different backup: stays protected
  const map2 = new Map([[KEY, raw], [BAK, 'older backup']]);
  const c = loadStore(fakeStorage(map2));
  assert.equal(c.open().status, 'corrupt-protected');
  map2.set(KEY, JSON.stringify({ gems: 1 }));
  assert.equal(c.read().unprotected, undefined);
  assert.equal(c.apply([run(1)]).reason, 'protected');
});

test('apply reports storage failures without writing', () => {
  const [a] = tabs({ gems: 10 }, 1);
  const before = a.ls.map.get(KEY);
  a.ls.fail.set = QUOTA;
  assert.equal(a.store.apply([run(1)]).reason, 'quota');
  a.ls.fail.get = () => domError('SecurityError', 18);
  assert.equal(a.store.apply([run(1)]).reason, 'unavailable');
  assert.equal(a.ls.map.get(KEY), before);
});

// ---------- the revive payment (M0.6c) ----------

const spend = (amount) => ({ type: 'spend', amount });

test('a revive payment from exactly its price succeeds and leaves nothing', () => {
  const [a] = tabs({ gems: 20 }, 1);
  const r = a.store.apply([spend(20)]);
  assert.equal(r.ok, true);
  assert.equal(stored(a).gems, 0);
  assert.equal(stored(a).rev, 1);
});

test('a revive payment the latest save cannot afford is refused and writes nothing', () => {
  const [a] = tabs({ gems: 19 }, 1);
  const before = a.ls.map.get(KEY);
  const r = a.store.apply([spend(20)]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rejected');
  assert.equal(r.latest.gems, 19, 'reports the balance it was checked against');
  assert.equal(r.save, undefined);
  assert.equal(a.ls.map.get(KEY), before, 'nothing written, not even a lower balance');
});

test('project() refuses an unaffordable payment instead of charging what is left', () => {
  const { store } = tabs(null, 1)[0];
  const p = store.project({ gems: 5 }, [spend(20)]);
  assert.equal(p.rejected, 'insufficient');
  assert.equal(p.save.gems, 5);
});

test('queued gems count towards a payment saved in the same write', () => {
  const [a] = tabs({ gems: 15 }, 1);
  const r = a.store.apply([run(5), spend(20)]);
  assert.equal(r.ok, true);
  assert.equal(stored(a).gems, 0);
  assert.equal(stored(a).plays, 1);
  assert.equal(stored(a).rev, 1, 'one write');
  assert.equal(a.store.apply([run(4), spend(20)]).reason, 'rejected', 'and not when they fall short');
  assert.equal(stored(a).plays, 1, 'a refused write keeps none of its changes');
});
