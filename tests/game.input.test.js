'use strict';
/*
 * Integration tests for input handling in js/game.js, run against the real scripts in the
 * stand-in browser from tests/helpers/world.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SCRIPTS, makeWorld, pausedWorld } = require('./helpers/world.js');

/** Storage holding a save with `gems` gems. */
const withGems = (gems) => new Map([['twin-snap-save-v1', JSON.stringify({ gems })]]);

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
  // Arrange: 50 gems stored (the revive is paid from the stored save)
  const w = makeWorld({ storage: withGems(50) });
  w.down(1);
  w.up(1);
  w.dieNow();
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

test('menu start and result-card restart begin at once, without a countdown or paused toggle', () => {
  const noPause = (w) => assert.equal(w.TS.UI.el.pause.hidden, true, 'paused toggle hidden');
  // Menu
  const w = makeWorld();
  w.down(1);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  noPause(w);
  w.up(1);
  // Result card: tap
  w.dieNow();
  w.passLock();
  w.down(2);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true);
  noPause(w);
  w.up(2);
  // Result card: button, with its sound toggle focused (the restart moves focus off it)
  w.dieNow();
  w.TS.UI.el.overSound.focus();
  w.TS.UI.handlers.onRetry();
  assert.equal(w.G.mode, 'play');
  noPause(w);
  assert.equal(w.document.activeElement, w.document.body);
});

// ---------- sound toggles on the title, result card and paused screen (M0.4) ----------

const soundButtons = (w) => [w.TS.UI.el.sound, w.TS.UI.el.overSound, w.TS.UI.el.pauseSound];
function assertSound(w, muted) {
  assert.equal(w.G.save.muted, muted);
  assert.equal(w.TS.Sfx.muted, muted);
  for (const b of soundButtons(w)) {
    assert.equal(b.textContent, muted ? 'Sound off' : 'Sound on');
    assert.equal(b.getAttribute('aria-pressed'), String(!muted));
  }
}
const savedMuted = (w) => JSON.parse(w.storage.get('twin-snap-save-v1')).muted;
const pauseShown = (w) => !w.TS.UI.el.pause.hidden;

test('the title-screen toggle still works and stays on the title', () => {
  const w = makeWorld();
  assertSound(w, false);
  w.click(w.TS.UI.el.sound);
  assertSound(w, true);
  assert.equal(savedMuted(w), true);
  assert.equal(w.G.mode, 'menu');
  assert.equal(w.TS.UI.el.menu.hidden, false);
  assert.equal(pauseShown(w), false);
});

test('the result-card toggle saves, mutes and stays on the result card; a reload keeps it', () => {
  // Arrange
  const w = makeWorld();
  w.startAndRelease();
  w.dieNow();
  // Act
  w.click(w.TS.UI.el.overSound);
  // Assert: all three buttons agree, nothing changed screen
  assertSound(w, true);
  assert.equal(savedMuted(w), true);
  assert.equal(w.G.mode, 'over');
  assert.equal(w.TS.UI.el.over.hidden, false);
  assert.equal(w.TS.UI.el.menu.hidden, true);
  // A reload with the same storage starts muted
  assertSound(makeWorld({ storage: w.storage }), true);
});

test('pressing the result-card toggle cannot restart the run', () => {
  const w = makeWorld();
  w.startAndRelease();
  w.dieNow();
  w.passLock();
  const btn = w.TS.UI.el.overSound;
  w.down(1, { target: btn });
  w.up(1);
  w.click(btn);
  w.keyDown('Space', { target: btn });
  assert.equal(w.G.mode, 'over');
  assertSound(w, true);
});

test('the paused toggle shows only while paused, and pressing it never resumes or holds', () => {
  const w = pausedWorld();
  const btn = w.TS.UI.el.pauseSound;
  assert.equal(pauseShown(w), true);
  // Act: press, release and click the toggle
  w.down(1, { target: btn });
  assert.equal(w.G.mode, 'ready', 'no countdown');
  assert.equal(w.G.held, false);
  w.up(1);
  w.click(btn);
  assertSound(w, true);
  assert.equal(w.G.mode, 'ready');
  assert.equal(pauseShown(w), true);
  // Act: resume from the playfield
  w.down(2);
  assert.equal(w.G.mode, 'count');
  for (let i = 0; i < 29; i++) {
    assert.equal(pauseShown(w), false, 'hidden for the whole countdown');
    w.wait(50);
  }
  assert.equal(w.G.mode, 'count');
  w.wait(50);
  assert.equal(w.G.mode, 'play', 'GO still at 1.5 s');
  assert.equal(pauseShown(w), false);
});

test('a toggle press that ends after the countdown has hidden it does nothing', () => {
  // Arrange: finger 1 on the toggle, finger 2 resumes from the playfield
  const w = pausedWorld();
  const btn = w.TS.UI.el.pauseSound;
  w.down(1, { target: btn });
  w.down(2, { isPrimary: false });
  assert.equal(w.G.mode, 'count');
  // Act: finger 1 lifts on the now-hidden button, and a browser still delivers its click
  w.up(1);
  w.click(btn);
  // Assert: no sound change, no hold, countdown unaffected
  assertSound(w, false);
  assert.equal(w.G.held, false);
  w.down(3, { isPrimary: false });
  w.wait(1500);
  assert.equal(w.G.mode, 'play');
  assert.equal(w.G.held, true, 'a playfield finger pressed during the countdown still holds');
  w.up(3);
  assert.equal(w.G.held, false);
});

test('focus: a pointer click lets go of the toggle, and hiding it moves focus away', () => {
  const w = pausedWorld();
  const btn = w.TS.UI.el.pauseSound;
  btn.focus();
  w.click(btn, 1);
  assert.notEqual(w.document.activeElement, btn);
  // Keyboard activation keeps focus, and Space on the focused button is not a game press
  btn.focus();
  w.click(btn, 0);
  assert.equal(w.document.activeElement, btn);
  w.keyDown('Space', { target: btn });
  assert.equal(w.G.mode, 'ready');
  // Act: resume from the playfield while the hidden-to-be button has focus
  w.down(1);
  assert.equal(w.document.activeElement, w.document.body, 'focus left the hidden button');
  w.click(btn, 0);
  assertSound(w, false); // toggled twice above, and the hidden button did nothing
});

test('interruptions during the countdown and revive both bring the paused toggle back', () => {
  const w = pausedWorld();
  w.down(1);
  assert.equal(pauseShown(w), false);
  w.blur();
  w.blur();
  w.hide();
  w.show();
  assert.equal(w.G.mode, 'ready');
  assert.equal(pauseShown(w), true);
  // Revive
  const r = makeWorld({ storage: withGems(50) });
  r.startAndRelease();
  r.dieNow();
  r.TS.UI.handlers.onRevive();
  assert.equal(r.G.mode, 'ready');
  assert.equal(pauseShown(r), true);
  assert.equal(r.TS.UI.el.over.hidden, true);
});

// ---------- viewport and paused layout around the twin line (M0.5) ----------

const TOGGLE_CSS_H = 56; // .btn: 17px text, 12px padding, 3px border, 5px shadow (CSS px)
const C_TWIN_TOP = 18; // twins are drawn ~14 units around the line, plus squash and stretch
const VIEWPORTS = [[360, 800], [400, 600], [1000, 800], [360, 640], [320, 568], [640, 300]];

test('viewports: tall phones keep their height; shorter and wider ones get a 640-high column', () => {
  for (const [vw, vh, cw, H] of [[360, 800, 360, 800], [400, 600, 337.5, 640], [1000, 800, 450, 640]]) {
    const w = makeWorld({ viewport: [vw, vh] });
    assert.equal(w.TS.UI.el.stage.style.width, cw + 'px', `${vw}x${vh}: column width`);
    assert.equal(w.G.H, H, `${vw}x${vh}: logical height`);
    w.startAndRelease();
    assert.equal(w.G.run.TY, 474, `${vw}x${vh}: twin line`);
  }
});

test('resizing mid-run between supported viewports never moves the twin line or the rows', () => {
  // Arrange
  const w = makeWorld({ viewport: [360, 800] });
  w.startAndRelease();
  w.tick(60);
  const rows = () => w.G.run.rows.map((r) => r.y);
  const before = rows();
  const gates = w.G.run.gates;
  // Act / Assert
  for (const [vw, vh] of [[400, 600], [1000, 800], [360, 800]]) {
    w.resizeTo(vw, vh);
    assert.equal(w.G.run.TY, 474, `${vw}x${vh}`);
    assert.deepEqual(rows(), before, `${vw}x${vh}: rows moved`);
    assert.equal(w.G.run.gates, gates);
  }
});

test('the paused screen is laid out around the twin line at every supported viewport', () => {
  for (const vp of VIEWPORTS) {
    const w = pausedWorld({ viewport: vp });
    const s = w.G.scale;
    const TY = w.G.run.TY;
    const centre = parseFloat(w.TS.UI.el.pause.style.top) / s; // toggle centre, game units
    const half = TOGGLE_CSS_H / 2 / s;
    const paused = w.textY('PAUSED');
    const pill = w.textY('TAP TO RESUME');
    const at = `${vp.join('x')}`;
    assert.ok(Math.abs(centre - (TY + w.TS.Render.PAUSE.toggle)) < 1e-9, `${at}: toggle follows the twin line`);
    assert.ok(paused + 27 < centre - half, `${at}: toggle overlaps PAUSED`);
    assert.ok(centre + half < TY - C_TWIN_TOP, `${at}: toggle overlaps the twins`);
    assert.ok(centre + half < pill - 14, `${at}: toggle overlaps TAP TO RESUME`);
    assert.ok(paused - 27 > 160, `${at}: PAUSED overlaps the score and meter`);
  }
});

test('the paused toggle moves with the twin line when the viewport changes while paused', () => {
  const w = pausedWorld({ viewport: [360, 800] });
  for (const [vw, vh] of [[400, 600], [640, 300], [360, 800]]) {
    w.resizeTo(vw, vh);
    const expected = (w.G.run.TY + w.TS.Render.PAUSE.toggle) * w.G.scale;
    assert.ok(Math.abs(parseFloat(w.TS.UI.el.pause.style.top) - expected) < 1e-9, `${vw}x${vh}`);
  }
});

test('the 3-2-1 digits sit where PAUSED was, clear of the score and the twins', () => {
  for (const vp of [[360, 800], [1000, 800]]) {
    const w = pausedWorld({ viewport: vp });
    const paused = w.textY('PAUSED');
    w.down(1);
    w.wait(50);
    const digit = w.textY('3');
    assert.equal(digit, paused, `${vp.join('x')}`);
    assert.ok(digit - 48 > 160 && digit + 48 < w.G.run.TY - C_TWIN_TOP);
  }
});
