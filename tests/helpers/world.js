'use strict';
/*
 * Shared test world: the real scripts, loaded in the order index.html lists them, inside a tiny
 * stand-in for the browser (no rendering or sound; storage is an in-memory map). Events are fired
 * at the same listeners the browser would call, and animation frames are advanced by hand.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1]);

/** An error shaped like the DOMExceptions browsers throw from localStorage. */
const domError = (name, code) => Object.assign(new Error(name), { name, code });

/**
 * localStorage backed by `map`, with switchable failures for failure-injection tests.
 * Set `fail.get`, `fail.set` or `fail.remove` to an error (or to a function of the key that
 * returns an error or null) to make that call throw. `map` is shared, so two calls with the same
 * map behave like one browser profile.
 */
function fakeStorage(map = new Map()) {
  const fail = { get: null, set: null, remove: null };
  const check = (kind, key) => {
    const f = typeof fail[kind] === 'function' ? fail[kind](key) : fail[kind];
    if (f) throw f;
  };
  return {
    map, fail,
    getItem(k) { check('get', k); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { check('set', k); map.set(k, String(v)); },
    removeItem(k) { check('remove', k); map.delete(k); },
  };
}

/**
 * Makes `window.localStorage` a getter that calls `get`, as a browser that blocks storage does.
 * A getter only runs inside a vm context when it is defined on the context's own global, and
 * `self` must point at that global (as `self === window` in a browser).
 */
function blockStorage(ctx, get) {
  ctx.__lsGet = get;
  vm.runInContext('Object.defineProperty(globalThis, "localStorage", { get: __lsGet, configurable: true });'
    + ' self = globalThis; delete globalThis.__lsGet;', ctx);
}

/**
 * @param {{storage?: Map<string, string>, localStorage?: object|Function, viewport?: [number, number]}} [opts]
 *   storage: share between worlds to simulate a reload. localStorage: a fakeStorage() to inject
 *   failures, or a function used as the window.localStorage getter (it may throw, as a blocked
 *   browser does). viewport: CSS width and height of #app.
 */
function makeWorld(opts = {}) {
  const storage = opts.storage || new Map();
  const clock = { t: 1000 };
  const bags = { win: {}, doc: {} };
  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const fire = (bag, type, e) => (bag[type] || []).slice().forEach((fn) => fn(e));
  const drawn = []; // text painted on the canvas during the latest frame, with its y in game units
  const ctx2d = new Proxy({}, {
    get: (t, k) => {
      if (k === 'fillText') return (text, x, y) => { drawn.push({ text: String(text), y }); };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set: () => true,
  });
  const makeEl = (tag) => {
    const bag = {};
    const attrs = {};
    return {
      bag, attrs, tag, style: {}, hidden: false, children: [], clientWidth: 360, clientHeight: 640,
      classList: { toggle() {}, add() {}, remove() {} },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener: on(bag),
      getContext: () => ctx2d,
      setPointerCapture() {},
      // Buttons and the result card count as controls, like Element.closest('button, .card').
      closest() { return tag === 'button' || /\bcard\b/.test(attrs.class || '') ? this : null; },
      contains(x) { return x === this || this.children.some((c) => c.contains && c.contains(x)); },
      focus() { document.activeElement = this; },
      blur() { if (document.activeElement === this) document.activeElement = document.body; },
    };
  };
  const app = makeEl('main');
  if (opts.viewport) [app.clientWidth, app.clientHeight] = opts.viewport;
  const document = {
    hidden: false, readyState: 'complete', body: makeEl('body'), activeElement: null,
    getElementById: (id) => (id === 'app' ? app : null),
    createElement: makeEl,
    addEventListener: on(bags.doc),
  };
  document.activeElement = document.body;
  const win = {
    document, devicePixelRatio: 1, navigator: {}, location: { href: 'test://twin-snap' },
    performance: { now: () => clock.t },
    requestAnimationFrame: (fn) => { win.nextFrame = fn; },
    setTimeout: () => 0, clearTimeout() {},
    addEventListener: on(bags.win),
  };
  if (typeof opts.localStorage !== 'function') win.localStorage = opts.localStorage || fakeStorage(storage);
  win.self = win;
  vm.createContext(win);
  if (typeof opts.localStorage === 'function') blockStorage(win, opts.localStorage);
  for (const src of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, src), 'utf8'), win, { filename: src });

  const TS = win.TS;
  const G = TS.Game;
  const stage = TS.UI.el.stage;
  const anywhere = { closest: () => null };
  const world = {
    G, TS, clock, storage, document,
    /** A click as the browser sends it: detail 1 for a pointer click, 0 for keyboard activation. */
    click(el, detail = 1) { fire(el.bag, 'click', { detail, currentTarget: el, target: el }); },
    tick(n = 1, ms = 16) {
      for (let i = 0; i < n; i++) { drawn.length = 0; clock.t += ms; win.nextFrame(clock.t); }
    },
    /** Text painted on the canvas in the latest frame. */
    texts: () => drawn.map((d) => d.text),
    /** Game-unit y of the last time `text` was painted in the latest frame (the shadow comes first). */
    textY(text) {
      const hit = drawn.filter((d) => d.text === text).pop();
      return hit ? hit.y : null;
    },
    /** Changes the viewport size and fires the window resize event, as rotating a phone would. */
    resizeTo(width, height) {
      app.clientWidth = width;
      app.clientHeight = height;
      fire(bags.win, 'resize', {});
    },
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

/** Starts a run, lets it play briefly, then loses focus so it pauses. */
function pausedWorld(opts) {
  const w = makeWorld(opts);
  w.startAndRelease();
  w.tick(3);
  w.blur();
  w.tick();
  assert.equal(w.G.mode, 'ready');
  return w;
}

module.exports = { ROOT, SCRIPTS, makeWorld, pausedWorld, fakeStorage, domError, blockStorage };
