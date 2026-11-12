'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Input = require('../js/input.js');

const A = Input.pointerId(1);
const B = Input.pointerId(2);
const SPACE = Input.keyId('Space');
const play = { mode: 'play' };

/** Applies presses in play mode and returns the resulting state. */
function holding(...ids) {
  return ids.reduce((s, id) => Input.down(s, id, play).state, Input.create());
}

test('a fresh state holds nothing', () => {
  assert.equal(Input.isHeld(Input.create()), false);
});

test('one finger down holds, the same finger up releases', () => {
  const down = Input.down(Input.create(), A, play);
  assert.equal(down.action, 'hold');
  assert.equal(down.first, true);
  assert.equal(Input.isHeld(down.state), true);
  assert.equal(Input.isHeld(Input.up(down.state, A)), false);
});

test('lifting one of two fingers keeps the hold', () => {
  // Arrange
  const both = holding(A, B);
  // Act
  const afterA = Input.up(both, A);
  const afterB = Input.up(afterA, B);
  // Assert
  assert.equal(Input.isHeld(afterA), true);
  assert.equal(Input.isHeld(afterB), false);
});

test('a second finger does not count as starting a new hold', () => {
  const second = Input.down(holding(A), B, play);
  assert.equal(second.action, 'hold');
  assert.equal(second.first, false);
});

test('a key and a finger are independent holds', () => {
  const both = holding(A, SPACE);
  assert.equal(Input.isHeld(Input.up(both, SPACE)), true, 'key up must not cancel the finger');
  assert.equal(Input.isHeld(Input.up(both, A)), true, 'finger up must not cancel the key');
  assert.equal(Input.isHeld(Input.up(Input.up(both, A), SPACE)), false);
});

test('a duplicate down for the same finger needs only one up', () => {
  // Arrange
  const once = holding(A);
  // Act
  const twice = Input.down(once, A, play);
  // Assert
  assert.equal(twice.first, false);
  assert.equal(twice.state, once, 'state object is reused when nothing changed');
  assert.equal(Input.isHeld(Input.up(twice.state, A)), false);
});

test('an up for a finger that was never down changes nothing', () => {
  const state = holding(A);
  assert.equal(Input.up(state, B), state);
  assert.equal(Input.up(Input.create(), A), Input.create());
});

test('interrupt drops every hold, and late ups are harmless', () => {
  // Arrange
  const state = holding(A, B, SPACE);
  // Act
  const dropped = Input.interrupt(state);
  // Assert
  assert.equal(Input.isHeld(dropped), false);
  assert.equal(Input.isHeld(Input.up(dropped, A)), false);
});

test('a primary pointer clears pointers whose up was lost, so a hold can never stick', () => {
  // Arrange: finger A went down and its up never arrived
  const stuck = holding(A);
  // Act: a new first finger goes down and up
  const pressed = Input.down(stuck, B, { mode: 'play', primary: true });
  const released = Input.up(pressed.state, B);
  // Assert
  assert.deepEqual([...pressed.state.ids], [B]);
  assert.equal(Input.isHeld(released), false);
});

test('a primary pointer does not clear a held key', () => {
  const pressed = Input.down(holding(SPACE), A, { mode: 'play', primary: true });
  assert.equal(Input.isHeld(Input.up(pressed.state, A)), true);
});

test('a non-primary pointer keeps the other fingers', () => {
  const pressed = Input.down(holding(A), B, { mode: 'play', primary: false });
  assert.deepEqual([...pressed.state.ids], [A, B]);
});

test('presses are ignored while dying, under a dialog, or right after the result card appears', () => {
  const state = holding(A);
  for (const ctx of [
    { mode: 'dying' },
    { mode: 'play', modal: true },
    { mode: 'menu', modal: true },
    { mode: 'over', locked: true },
    { mode: 'something-else' },
    undefined,
  ]) {
    const r = Input.down(state, B, ctx);
    assert.equal(r.action, 'ignore', JSON.stringify(ctx));
    assert.equal(r.state, state, 'ignored presses are not recorded');
    assert.equal(r.first, false);
  }
});

test('starting begins from that one press, nothing older carries over', () => {
  // Arrange: stale holds left over from a previous run
  const stale = holding(A, SPACE);
  for (const ctx of [{ mode: 'menu' }, { mode: 'over', locked: false }]) {
    // Act
    const r = Input.down(stale, B, ctx);
    // Assert
    assert.equal(r.action, 'start');
    assert.deepEqual([...r.state.ids], [B]);
    assert.equal(Input.isHeld(Input.up(r.state, B)), false, 'one up releases');
  }
});

test('the resume press is never recorded, and stale holds are dropped', () => {
  // Arrange
  const stale = holding(A, SPACE);
  // Act
  const r = Input.down(stale, B, { mode: 'ready' });
  // Assert
  assert.equal(r.action, 'resume');
  assert.equal(r.first, false);
  assert.equal(Input.isHeld(r.state), false);
  assert.equal(Input.up(r.state, B), r.state, 'its later release changes nothing');
});

test('fresh presses during the countdown are recorded and released like in play', () => {
  const count = { mode: 'count' };
  // Act
  const r = Input.down(Input.create(), B, count);
  // Assert
  assert.equal(r.action, 'hold');
  assert.equal(Input.isHeld(r.state), true);
  assert.equal(Input.isHeld(Input.up(r.state, B)), false);
  const two = Input.down(r.state, SPACE, count).state;
  assert.equal(Input.isHeld(Input.up(two, B)), true, 'key and finger stay independent');
});

test('a primary press during the countdown also clears pointers whose up was lost', () => {
  const stuck = Input.down(Input.create(), A, { mode: 'count' }).state;
  const pressed = Input.down(stuck, B, { mode: 'count', primary: true });
  assert.deepEqual([...pressed.state.ids], [B]);
});

test('states are immutable', () => {
  const state = holding(A);
  assert.throws(() => { state.ids.push(B); }, TypeError);
  Input.down(state, B, play);
  Input.up(state, A);
  assert.deepEqual([...state.ids], [A]);
});

test('pointer ids and key ids cannot collide', () => {
  assert.notEqual(Input.pointerId('Space'), Input.keyId('Space'));
  assert.notEqual(Input.pointerId(1), Input.keyId(1));
});
