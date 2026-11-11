'use strict';
/*
 * Integration tests for input handling in js/game.js.
 * The real scripts are loaded in the order index.html lists them, inside a tiny stand-in for
 * the browser (no rendering, no sound, no storage). Events are fired at the same listeners the
 * browser would call, and animation frames are advanced by hand.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1]);

function makeWorld() {
  const clock = { t: 1000 };
  const bags = { win: {}, doc: {} };
  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const fire = (bag, type, e) => (bag[type] || []).slice().forEach((fn) => fn(e));
  const drawn = []; // text painted on the canvas during the latest frame
  const ctx2d = new Proxy({}, {
    get: (t, k) => {
      if (k === 'fillText') return (text) => { drawn.push(String(text)); };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set: () => true,
  });
  const makeEl = () => {
    const bag = {};
    return {
      bag, style: {}, hidden: false, children: [], clientWidth: 360, clientHeight: 640,
      classList: { toggle() {}, add() {}, remove() {} },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute() {},
      addEventListener: on(bag),
      getContext: () => ctx2d,
      setPointerCapture() {},
      closest: () => null,
    };
  };
  const app = makeEl();
  const document = {
    hidden: false, readyState: 'complete',
    getElementById: (id) => (id === 'app' ? app : null),
    createElement: makeEl,
    addEventListener: on(bags.doc),
  };
  const win = {
    document, devicePixelRatio: 1, navigator: {}, location: { href: 'test://twin-snap' },
    performance: { now: () => clock.t },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (fn) => { win.nextFrame = fn; },
    setTimeout: () => 0, clearTimeout() {},
    addEventListener: on(bags.win),
  };
  win.self = win;
  vm.createContext(win);
  for (const src of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, src), 'utf8'), win, { filename: src });

  const TS = win.TS;
  const G = TS.Game;
  const stage = TS.UI.el.stage;
  const anywhere = { closest: () => null };
  const world = {
    G, TS, clock,
    tick(n = 1, ms = 16) {
      for (let i = 0; i < n; i++) { drawn.length = 0; clock.t += ms; win.nextFrame(clock.t); }
    },
    /** Text painted on the canvas in the latest frame. */
    texts: () => drawn.slice(),
    /** Advances `ms` of countdown time in 50 ms frames (the longest frame the loop accepts). */
    wait(ms) { world.tick(ms / 50, 50); },
    down(id, o) {
      fire(stage.bag, 'pointerdown', {
        pointerId: id, pointerType: 'touch', isPrimary: true, button: 0, target: stage, preventDefault() {}, ...o,
      });
    },
    up(id) { fire(bags.win, 'pointerup', { pointerId: id }); },
    cancel(id) { fire(bags.win, 'pointercancel', { pointerId: id }); },
    lostCapture(id) { fire(stage.bag, 'lostpointercapture', { pointerId: id }); },
    keyDown(code, o) { fire(bags.win, 'keydown', { code, repeat: false, target: anywhere, preventDefault() {}, ...o }); },
    keyUp(code) { fire(bags.win, 'keyup', { code }); },
    blur() { fire(bags.win, 'blur', {}); },
    hide() { document.hidden = true; fire(bags.doc, 'visibilitychange', {}); },
    show() { document.hidden = false; fire(bags.doc, 'visibilitychange', {}); },
    /** Runs frames until the game reaches `mode`. */
    until(mode) {
      for (let i = 0; i < 4000 && G.mode !== mode; i++) world.tick();
      assert.equal(G.mode, mode, `never reached ${mode}`);
    },
    /** Starts a run with finger `id` and lets go again. */
    startAndRelease(id = 1) { world.down(id); world.up(id); world.tick(); },
    /** Plays hands-off until the first block ends the run. */
    dieNow() { world.until('over'); },
    passLock() { world.tick(40); },
  };
  world.tick();
  assert.equal(G.mode, 'menu');
  return world;
}

test('the page loads the input module before the game', () => {
  assert.ok(SCRIPTS.includes('js/input.js'), 'index.html must load js/input.js');
  assert.ok(SCRIPTS.indexOf('js/input.js') < SCRIPTS.indexOf('js/game.js'));
});

test('first press starts a run and holds; release lets go', () => {
  const w = makeWorld();
  w.down(1);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  w.up(1);
  assert.equal(w.G.held, false);
});

test('lifting a second finger does not cancel the first', () => {
  // Arrange
  const w = makeWorld();
  w.down(1);
  w.down(2, { isPrimary: false });
  // Act / Assert
  w.up(2);
  assert.equal(w.G.held, true, 'finger 1 is still down');
  w.up(1);
  assert.equal(w.G.held, false);
});

test('lifting the first finger keeps the hold while the second stays down', () => {
  const w = makeWorld();
  w.down(1);
  w.down(2, { isPrimary: false });
  w.up(1);
  assert.equal(w.G.held, true);
  w.up(2);
  assert.equal(w.G.held, false);
});

test('one cancelled finger out of two keeps the hold', () => {
  const w = makeWorld();
  w.down(1);
  w.down(2, { isPrimary: false });
  w.cancel(2);
  assert.equal(w.G.held, true);
  w.cancel(1);
  assert.equal(w.G.held, false);
});

test('releasing a key does not cancel a finger, and the other way round', () => {
  const w = makeWorld();
  w.down(1);
  w.keyDown('Space');
  w.keyUp('Space');
  assert.equal(w.G.held, true, 'finger still down');
  w.keyDown('Space');
  w.up(1);
  assert.equal(w.G.held, true, 'key still down');
  w.keyUp('Space');
  assert.equal(w.G.held, false);
});

test('a duplicate pointerdown needs only one pointerup', () => {
  const w = makeWorld();
  w.down(1);
  w.down(1);
  w.up(1);
  assert.equal(w.G.held, false);
});

test('a stray pointerup for an unknown pointer does not release the hold', () => {
  const w = makeWorld();
  w.down(1);
  w.up(99);
  assert.equal(w.G.held, true);
});

test('losing pointer capture releases that finger', () => {
  const w = makeWorld();
  w.down(1);
  w.lostCapture(1);
  assert.equal(w.G.held, false);
});

test('a finger whose release was lost cannot keep the twins split forever', () => {
  // Arrange: finger 1 goes down and its release never arrives
  const w = makeWorld();
  w.down(1);
  // Act: the player taps again
  w.down(2);
  w.up(2);
  // Assert
  assert.equal(w.G.held, false);
});

test('right and middle mouse buttons do not play', () => {
  const w = makeWorld();
  w.down(1, { pointerType: 'mouse', button: 2 });
  assert.equal(w.G.mode, 'menu');
  w.down(1, { pointerType: 'mouse', button: 1 });
  assert.equal(w.G.mode, 'menu');
  w.down(1, { pointerType: 'mouse', button: 0 });
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
});

test('key auto-repeat and keys pressed on a button are ignored', () => {
  const w = makeWorld();
  w.keyDown('Space', { repeat: true });
  assert.equal(w.G.mode, 'menu');
  w.keyDown('Space', { target: { closest: () => ({}) } });
  assert.equal(w.G.mode, 'menu');
  w.keyDown('KeyA');
  assert.equal(w.G.mode, 'menu');
  w.keyDown('ArrowUp');
  assert.equal(w.G.mode, 'play');
});

test('losing window focus mid-hold pauses the run and drops the hold', () => {
  // Arrange
  const w = makeWorld();
  w.down(1);
  w.tick(5);
  // Act
  w.blur();
  // Assert
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.held, false);
  const time = w.G.run.time;
  w.tick(30);
  assert.equal(w.G.run.time, time, 'the run does not advance while paused');
  w.up(1);
  assert.equal(w.G.mode, 'ready', 'the late release does not resume');
});

test('hiding the page mid-hold pauses the run; the stale finger never comes back', () => {
  // Arrange
  const w = makeWorld();
  w.down(1);
  w.tick(5);
  // Act
  w.hide();
  w.show();
  // Assert: still paused, the finger that was down no longer counts
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.held, false);
  w.tick(10);
  assert.equal(w.G.held, false);
  // Act: resume, then a fresh press after GO
  w.down(3);
  w.up(3);
  w.wait(1500);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false);
  w.down(4);
  assert.equal(w.G.held, true);
  w.up(4);
  assert.equal(w.G.held, false, 'the stale finger does not keep it held');
});

test('focus loss outside a run changes no mode', () => {
  const w = makeWorld();
  w.blur();
  assert.equal(w.G.mode, 'menu');
  w.startAndRelease();
  w.dieNow();
  w.blur();
  w.hide();
  w.show();
  assert.equal(w.G.mode, 'over');
});

test('presses while dying are ignored and do not leak into the next run', () => {
  // Arrange
  const w = makeWorld();
  w.startAndRelease();
  w.until('dying');
  // Act
  w.down(5);
  // Assert
  assert.equal(w.G.mode, 'dying');
  assert.equal(w.G.held, false);
  w.until('over');
  w.passLock();
  assert.equal(w.G.mode, 'over', 'a finger held since dying does not restart');
  w.TS.UI.handlers.onRetry();
  w.tick();
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false);
});

test('a finger held through death does not carry into a restart by button', () => {
  // Arrange: finger 1 never lifts. Held wide, the twins clear the first centre block and
  // then hit the side walls of the second row, so the run ends with the finger still down.
  const w = makeWorld();
  w.down(1);
  w.until('over');
  assert.ok(w.G.run.gates >= 1, 'precondition: died on a later row while holding');
  // Act
  w.TS.UI.handlers.onRetry();
  w.tick();
  // Assert
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false, 'new run must start released');
  w.up(1);
  assert.equal(w.G.held, false);
  w.down(2);
  assert.equal(w.G.held, true);
});

test('the result card ignores taps at first, then a tap restarts holding', () => {
  // Arrange
  const w = makeWorld();
  w.startAndRelease();
  w.dieNow();
  // Act / Assert: too early
  w.down(1);
  assert.equal(w.G.mode, 'over');
  w.up(1);
  // Act / Assert: after the lock
  w.passLock();
  w.down(2);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  w.up(2);
  assert.equal(w.G.held, false);
});

test('revive pauses, then uses the same tap and countdown to resume', () => {
  // Arrange
  const w = makeWorld();
  w.down(1);
  w.up(1);
  w.dieNow();
  w.G.save = { ...w.G.save, gems: 50 };
  // Act
  w.TS.UI.handlers.onRevive();
  w.tick(5);
  // Assert
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.held, false);
  assert.ok(w.texts().includes('PAUSED'));
  w.down(4);
  assert.equal(w.G.mode, 'count');
  assert.equal(w.G.held, false, 'the resume tap is not a hold');
  w.wait(1450);
  assert.equal(w.G.mode, 'count');
  w.wait(50);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false, 'finger 4 is still down but was the resume tap');
  w.up(4);
  w.down(5);
  assert.equal(w.G.held, true);
});

test('presses under an open dialog are ignored', () => {
  // Arrange
  const w = makeWorld();
  w.TS.UI.handlers.onSkins();
  // Act
  w.down(1);
  w.keyDown('Space');
  // Assert
  assert.equal(w.G.mode, 'menu');
  assert.equal(w.G.held, false);
});

// ---------- pause and resume countdown (M0.3) ----------

/** Starts a run, lets it play briefly, then loses focus so it pauses. */
function pausedWorld() {
  const w = makeWorld();
  w.startAndRelease();
  w.tick(3);
  w.blur();
  w.tick();
  assert.equal(w.G.mode, 'ready');
  return w;
}

/** Everything the simulation owns, as text (functions such as the RNG are left out). */
const snapshot = (run) => JSON.stringify(run);

/** Counts calls to the run's random number generator from now on. */
function countRng(run) {
  const calls = { n: 0 };
  const rng = run.rng;
  run.rng = () => { calls.n++; return rng(); };
  return calls;
}

test('the paused screen says PAUSED and TAP TO RESUME', () => {
  const w = pausedWorld();
  const texts = w.texts();
  assert.ok(texts.includes('PAUSED'), texts.join('|'));
  assert.ok(texts.includes('TAP TO RESUME'));
  assert.ok(!texts.includes('HOLD TO CONTINUE'));
});

test('the resume tap starts a countdown and is not recorded as a hold', () => {
  const w = pausedWorld();
  w.down(1);
  assert.equal(w.G.mode, 'count');
  assert.equal(w.G.held, false);
  assert.equal(w.G.countDigit, 3);
});

test('the countdown shows 3, 2, 1 for 500 ms each and ends at exactly 1.5 s', () => {
  // Arrange
  const w = pausedWorld();
  w.down(1);
  w.up(1);
  const seen = [];
  // Act: 50 ms frames
  for (let k = 1; k <= 29; k++) {
    w.wait(50);
    assert.equal(w.G.mode, 'count', `still counting at ${k * 50} ms`);
    seen.push(w.G.countDigit);
    assert.ok(w.texts().includes(String(w.G.countDigit)), 'the digit is drawn');
    assert.ok(!w.texts().includes('PAUSED'));
  }
  w.wait(50);
  // Assert
  assert.equal(w.G.mode, 'play', 'GO at 1500 ms');
  const expected = [...Array(9).fill(3), ...Array(10).fill(2), ...Array(10).fill(1)];
  assert.deepEqual(seen, expected);
});

test('a tap between frames: GO never comes before 1.5 s after the tap', () => {
  // Arrange: the tap lands 15 ms after the last frame was drawn
  const w = pausedWorld();
  w.clock.t += 15;
  const tapAt = w.clock.t;
  // Act
  w.down(1);
  w.up(1);
  assert.equal(w.G.countDigit, 3, 'the first digit is 3');
  const firstSeen = {};
  let goAt = null;
  for (let i = 0; i < 200 && goAt === null; i++) {
    w.tick(1, 16);
    const since = w.clock.t - tapAt;
    if (w.G.mode === 'play') goAt = since;
    else {
      assert.ok([3, 2, 1].includes(w.G.countDigit), `invalid digit ${w.G.countDigit} at ${since} ms`);
      if (!(w.G.countDigit in firstSeen)) firstSeen[w.G.countDigit] = since;
    }
  }
  // Assert
  assert.ok(goAt >= 1500, `GO at ${goAt} ms after the tap`);
  assert.ok(goAt < 1500 + 16, `GO on the first frame after 1500 ms, not ${goAt}`);
  assert.ok(firstSeen[3] < 500, 'shows 3 at once');
  assert.ok(firstSeen[2] >= 500, `2 at ${firstSeen[2]} ms`);
  assert.ok(firstSeen[1] >= 1000, `1 at ${firstSeen[1]} ms`);
});

test('the simulation stays frozen for the whole countdown', () => {
  // Arrange
  const w = pausedWorld();
  const before = snapshot(w.G.run);
  const rng = countRng(w.G.run);
  // Act
  w.down(1);
  w.down(2, { isPrimary: false }); // a fresh press that will be held at GO
  w.wait(1450);
  // Assert: nothing moved, scored, spawned or counted down
  assert.equal(w.G.mode, 'count');
  assert.equal(snapshot(w.G.run), before);
  assert.equal(rng.n, 0, 'the level generator was not consulted');
  // Act: GO, then real play
  w.wait(50);
  assert.equal(w.G.mode, 'play');
  w.tick(20);
  assert.notEqual(snapshot(w.G.run), before, 'the run moves again after GO');
});

test('the resume press and its release never affect play', () => {
  // Arrange
  const w = pausedWorld();
  w.down(1);
  w.wait(1500);
  // Assert: finger 1 is still down at GO but does not hold
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false);
  // Act: a fresh press, then the old finger finally lifts
  w.down(2, { isPrimary: false });
  w.up(1);
  // Assert
  assert.equal(w.G.held, true, 'releasing the resume finger does not cancel the fresh one');
  w.up(2);
  assert.equal(w.G.held, false);
});

test('a fresh press during the countdown still held at GO becomes a hold', () => {
  const w = pausedWorld();
  w.down(1);
  w.up(1);
  w.wait(700);
  w.down(2);
  assert.equal(w.G.held, false, 'not before GO');
  w.wait(800);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  w.up(2);
  assert.equal(w.G.held, false);
});

test('a fresh countdown press released before GO is forgotten', () => {
  const w = pausedWorld();
  w.down(1);
  w.up(1);
  w.wait(500);
  w.down(2);
  w.wait(500);
  w.up(2);
  w.wait(500);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false);
});

test('a fresh key during the countdown counts at GO; the resume key does not', () => {
  // Arrange
  const w = pausedWorld();
  w.keyDown('Space');
  assert.equal(w.G.mode, 'count');
  w.keyDown('Space', { repeat: true });
  w.wait(1500);
  assert.equal(w.G.held, false, 'the resume key held through the countdown is not a hold');
  // Act: release and press again during a second pause's countdown
  w.blur();
  w.keyDown('ArrowUp');
  w.wait(500);
  w.keyUp('ArrowUp');
  w.keyDown('ArrowUp');
  w.wait(1000);
  // Assert
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  w.keyUp('ArrowUp');
  assert.equal(w.G.held, false);
});

test('input after GO works normally', () => {
  const w = pausedWorld();
  w.down(1);
  w.up(1);
  w.wait(1500);
  w.down(2);
  assert.equal(w.G.held, true);
  w.down(3, { isPrimary: false });
  w.up(2);
  assert.equal(w.G.held, true);
  w.up(3);
  assert.equal(w.G.held, false);
});

test('focus loss during the countdown cancels it, clears input, and needs a fresh countdown', () => {
  // Arrange
  const w = pausedWorld();
  w.down(1);
  w.up(1);
  w.wait(1000);
  w.down(2);
  // Act
  w.blur();
  // Assert
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.held, false);
  w.wait(1000);
  assert.equal(w.G.mode, 'ready', 'the countdown does not finish on its own');
  assert.ok(w.texts().includes('PAUSED'));
  // Act: second resume attempt
  w.down(3);
  assert.equal(w.G.countDigit, 3, 'a fresh countdown from 3');
  w.up(3);
  w.wait(1450);
  assert.equal(w.G.mode, 'count');
  w.wait(50);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false, 'finger 2 from the cancelled countdown does not count');
});

test('hiding the page during the countdown cancels it too', () => {
  const w = pausedWorld();
  w.down(1);
  w.wait(500);
  w.down(2, { isPrimary: false });
  w.hide();
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.held, false);
  w.show();
  w.wait(2000);
  assert.equal(w.G.mode, 'ready');
});

test('repeated focus and visibility events are harmless', () => {
  const w = pausedWorld();
  w.blur();
  w.blur();
  w.hide();
  w.show();
  w.show();
  assert.equal(w.G.mode, 'ready');
  w.down(1);
  w.blur();
  w.blur();
  w.hide();
  w.hide();
  w.show();
  assert.equal(w.G.mode, 'ready');
  assert.equal(w.G.held, false);
  w.down(2);
  w.up(2);
  w.wait(1500);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, false);
});

test('menu start and result-card restart begin at once, without a countdown', () => {
  // Menu
  const w = makeWorld();
  w.down(1);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  w.up(1);
  // Result card: tap
  w.dieNow();
  w.passLock();
  w.down(2);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  w.up(2);
  // Result card: button
  w.dieNow();
  w.TS.UI.handlers.onRetry();
  assert.equal(w.G.mode, 'play');
});
