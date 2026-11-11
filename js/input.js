/*
 * Twin Snap — input state. Pure logic, no DOM, runs in the browser and in Node tests.
 *
 * The game has one verb: something is being held, or nothing is. This module tracks *which*
 * fingers and keys are down, so that lifting one finger does not cancel another, a duplicate
 * or stray event changes nothing, and an interruption can drop every hold at once.
 *
 * States are immutable: every function returns a new state (or the same one if nothing changed).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TS = root.TS || {}).Input = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POINTER = 'p:';
  const KEY = 'k:';
  const EMPTY = Object.freeze({ ids: Object.freeze([]) });
  const make = (ids) => (ids.length ? Object.freeze({ ids: Object.freeze(ids) }) : EMPTY);

  /** @returns {{ids: readonly string[]}} a state with nothing held */
  const create = () => EMPTY;
  const pointerId = (id) => POINTER + id;
  const keyId = (code) => KEY + code;
  const isHeld = (state) => state.ids.length > 0;

  const ignored = (state) => ({ state, action: 'ignore', first: false });

  /**
   * A finger, mouse button or key went down.
   * @param {{ids: readonly string[]}} state
   * @param {string} id from pointerId() or keyId()
   * @param {{mode: string, modal?: boolean, locked?: boolean, primary?: boolean}} ctx
   *   mode: current game mode. modal: a dialog covers the game. locked: the result card has only
   *   just appeared. primary: the browser says no other pointer of this kind is down.
   * @returns {{state: object, action: 'ignore'|'hold'|'start'|'resume', first: boolean}}
   *   action tells the game what the press means; first is true when it began a new hold.
   */
  function down(state, id, ctx) {
    const c = ctx || {};
    if (c.modal) return ignored(state);
    // Starting or resuming always begins from this one press: nothing older carries over.
    if (c.mode === 'menu') return { state: make([id]), action: 'start', first: true };
    if (c.mode === 'over') return c.locked ? ignored(state) : { state: make([id]), action: 'start', first: true };
    if (c.mode === 'ready') return { state: make([id]), action: 'resume', first: true };
    if (c.mode !== 'play') return ignored(state);

    // A primary pointer means no other pointer is really down, so any pointer still on record
    // lost its "up" event. Forget those, or the twins would stay split for good.
    const kept = c.primary ? state.ids.filter((x) => !x.startsWith(POINTER)) : state.ids;
    const wasHeld = isHeld(state);
    if (kept.includes(id)) {
      return { state: kept.length === state.ids.length ? state : make(kept), action: 'hold', first: false };
    }
    return { state: make(kept.concat(id)), action: 'hold', first: !wasHeld };
  }

  /** A finger, mouse button or key went up or was cancelled. Unknown ids change nothing. */
  function up(state, id) {
    return state.ids.includes(id) ? make(state.ids.filter((x) => x !== id)) : state;
  }

  /** The game was interrupted (focus lost, death, restart, revive): drop every hold. */
  const interrupt = () => EMPTY;

  return { create, pointerId, keyId, isHeld, down, up, interrupt };
});
