/* Twin Snap — game loop, input and the glue between simulation, effects, sound and menus. */
(function (root) {
  'use strict';
  const TS = root.TS;
  const { Core, CFG, Input, Store, Sfx, Fx, Render, UI, Ads } = TS;
  const { C } = Core;
  const doc = root.document;

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toTheme = (t) => ({ top: hex(t.top), bot: hex(t.bot), block: hex(t.block), rim: hex(t.rim) });
  const THEMES = CFG.THEMES.map(toTheme);
  const FEVER_THEME = toTheme(CFG.FEVER_THEME);
  const cloneTheme = (t) => ({ top: t.top.slice(), bot: t.bot.slice(), block: t.block.slice(), rim: t.rim.slice() });
  const skinOf = (save) => CFG.SKINS.find((s) => s.id === save.skin) || CFG.SKINS[0];
  const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

  const G = {
    mode: 'menu', // menu (demo plays) | play | ready (paused) | count (3-2-1 to resume) | dying | over
    countMs: 0, countDigit: 0, // time spent in the resume countdown, and the number on screen
    ctx: null, dpr: 1, scale: 1, H: 640,
    run: null, held: false, save: Store.load(), skin: null,
    theme: cloneTheme(THEMES[0]), themeIdx: 0, lvl: 0,
    streaks: [], trail: [], flow: 0, scroll: 0, time: 0, last: 0, acc: 0,
    shake: 0, flash: 0, squash: 0, scorePop: 0, gemPop: 0, hitstop: 0, hint: '',
    deadT: 0, overAt: 0, revived: false, banked: 0, shopFrom: 'menu', overData: null,
    bokeh: [], feverK: 0, smashes: 0, sparkT: 0,
    recordGate: -1, // ordinal of the row that beats the player's best run; -1 hides the flag
  };
  G.skin = skinOf(G.save);
  Sfx.muted = G.save.muted;

  function resize() {
    const app = doc.getElementById('app');
    const vw = app.clientWidth;
    const vh = app.clientHeight;
    if (!vw || !vh) return;
    const cw = vw / vh > 0.68 ? Math.round(vh * 0.5625) : vw; // wide screens get a phone-shaped column
    const e = UI.el;
    e.stage.style.width = cw + 'px';
    e.stage.style.height = vh + 'px';
    G.dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    G.scale = cw / C.W;
    G.H = vh / G.scale;
    e.canvas.width = Math.round(cw * G.dpr);
    e.canvas.height = Math.round(vh * G.dpr);
    if (G.run) {
      const dy = Core.resizeRun(G.run, G.H);
      for (let i = 0; i < G.trail.length; i++) G.trail[i].y += dy;
    }
  }

  function resetRunState() {
    G.lvl = 0;
    G.themeIdx = 0;
    G.banked = 0;
    G.revived = false;
    G.trail.length = 0;
    G.acc = 0;
    G.hitstop = 0;
    G.feverK = 0;
    G.smashes = 0;
    G.recordGate = -1;
    Fx.clear();
  }

  function attract() {
    resetRunState();
    G.run = Core.createRun(newSeed(), G.H);
    G.mode = 'menu';
    UI.showMenu(G.save);
  }

  function startRun() {
    dropInput(); // a new run never inherits a hold; the press that starts it is added afterwards
    resetRunState();
    G.run = Core.createRun(newSeed(), G.H);
    G.mode = 'play';
    if (G.save.bestGates >= 3) G.recordGate = G.save.bestGates;
    UI.hideAll();
  }

  function die() {
    const run = G.run;
    G.mode = 'dying';
    G.deadT = 0;
    dropInput();
    const vw = Math.max(run.twin.w, 12);
    Fx.burst(C.HALF - vw, run.TY, G.skin.a, 34, 380, 520);
    Fx.burst(C.HALF + vw, run.TY, G.skin.b, 34, 380, 520);
    Fx.burst(C.HALF, run.TY, '#ffffff', 16, 260, 300);
    Fx.ring(C.HALF, run.TY, '#ffffff', 420);
    G.shake = 18;
    G.flash = 0.7;
    Sfx.dead();
  }

  function finish() {
    const run = G.run;
    const earned = run.gems - G.banked;
    G.banked = run.gems;
    const prevBest = G.save.best;
    const isBest = run.score > prevBest;
    G.save = Store.update(G.save, {
      best: Math.max(prevBest, run.score),
      bestGates: Math.max(G.save.bestGates, run.gates),
      gems: G.save.gems + earned,
      plays: G.save.plays + (G.revived ? 0 : 1),
    });
    G.mode = 'over';
    G.overAt = root.performance.now();
    G.overData = {
      score: run.score, best: G.save.best, prevBest, isBest,
      toBeat: G.save.best - run.score + 1, earned: run.gems, gems: G.save.gems, canRevive: !G.revived,
    };
    if (isBest) Sfx.best();
    UI.showOver(G.overData);
    Ads.interstitial();
  }

  function revive() {
    G.revived = true;
    Core.reviveRun(G.run);
    G.mode = 'ready';
    dropInput();
    UI.hideAll();
    UI.showPause();
  }

  function onPass(e, loud) {
    const run = G.run;
    e.row.flash = 1;
    if (!loud) return;
    G.scorePop = 1;
    Sfx.pass(run.gates - 1);
    if (!e.row.broken) {
      // sparks off the gap edges as the twins clear them
      const y = run.TY + 6;
      if (e.row.ca > 0) { Fx.burst(C.HALF - e.row.ca, y, '#ffffff', 3, 90, 0); Fx.burst(C.HALF + e.row.ca, y, '#ffffff', 3, 90, 0); }
      if (e.row.cb < C.HALF) { Fx.burst(C.HALF - e.row.cb, y, '#ffffff', 3, 90, 0); Fx.burst(C.HALF + e.row.cb, y, '#ffffff', 3, 90, 0); }
    }
    if (e.row.n === G.recordGate) {
      Fx.pop(C.HALF, G.H * 0.3, 'NEW RECORD!', '#FFD23F', 30);
      Fx.confetti(C.W, CFG.CONFETTI);
      Sfx.record();
    }
    if (e.graze) {
      Fx.pop(C.HALF, run.TY - 52, 'CLOSE! +1', '#FFD23F', 18);
      Sfx.graze();
    }
    const lvl = Math.floor(run.gates / 10);
    if (lvl > G.lvl) {
      G.lvl = lvl;
      G.themeIdx = lvl % THEMES.length;
      Fx.pop(C.HALF, G.H * 0.36, CFG.PRAISE[Math.min(lvl - 1, CFG.PRAISE.length - 1)], '#ffffff', 34);
      Fx.confetti(C.W, CFG.CONFETTI);
      Sfx.level();
    }
  }

  function onSmash(e, loud) {
    const run = G.run;
    const r = e.row;
    const colors = ['rgb(' + G.theme.block.map(Math.round).join(',') + ')', '#ffffff', '#FFD23F'];
    if (r.ca > 0) Fx.shatter(C.HALF - r.ca, r.y, r.ca * 2, r.h, colors, 22);
    if (r.cb < C.HALF) {
      Fx.shatter(0, r.y, C.HALF - r.cb, r.h, colors, 14);
      Fx.shatter(C.HALF + r.cb, r.y, C.HALF - r.cb, r.h, colors, 14);
    }
    Fx.ring(C.HALF, run.TY, '#FFE27A', 380);
    if (!loud) return;
    G.smashes++;
    G.shake = 12;
    G.hitstop = 0.045;
    G.scorePop = 1;
    Fx.pop(C.HALF, run.TY - 56, 'SMASH! +2', '#FFD23F', 24);
    Sfx.smash(G.smashes);
  }

  function onFever(loud) {
    const run = G.run;
    Fx.ring(C.HALF, run.TY, '#FFD23F', 620);
    Fx.ring(C.HALF, run.TY, '#ffffff', 380);
    Fx.burst(C.HALF, run.TY, '#FFD23F', 30, 420, 0);
    if (!loud) return;
    G.smashes = 0;
    G.flash = 0.45;
    G.shake = 10;
    Fx.pop(C.HALF, G.H * 0.42, 'FEVER!', '#FFD23F', 44);
    Sfx.fever();
  }

  function handle(events, loud) {
    const run = G.run;
    for (const e of events) {
      if (e.t === 'pass') onPass(e, loud);
      else if (e.t === 'smash') onSmash(e, loud);
      else if (e.t === 'fever') onFever(loud);
      else if (e.t === 'feverEnd') { if (loud) Sfx.feverEnd(); }
      else if (e.t === 'snap') {
        G.squash = 1;
        Fx.burst(C.HALF, run.TY, '#ffffff', 8, 170, 0);
        if (loud) { G.shake = Math.max(G.shake, 3); Sfx.snap(); }
      } else if (e.t === 'gem') {
        Fx.burst(C.HALF - e.g, run.TY, '#FFE066', 7, 150, 0);
        Fx.burst(C.HALF + e.g, run.TY, '#FFE066', 7, 150, 0);
        if (loud) { G.gemPop = 1; Sfx.gem(); }
      } else if (e.t === 'crush') {
        Fx.burst(C.HALF, e.y, '#9BE8FF', 26, 330, 320);
        Fx.burst(C.HALF, e.y, '#ffffff', 12, 220, 0);
        Fx.ring(C.HALF, e.y, '#E9FBFF', 300);
        G.squash = 1;
        if (loud) {
          G.shake = 10;
          G.hitstop = 0.07;
          G.scorePop = 1;
          G.gemPop = 1;
          const label = (e.chain > 1 ? '×' + e.chain + ' ' : '') + 'SNAP! +' + e.bonus;
          Fx.pop(C.HALF, e.y - 44, label, '#9BE8FF', 22 + Math.min(e.chain, 5) * 2);
          Sfx.crush(e.chain);
        }
      } else if (e.t === 'dead') {
        if (loud) die();
        else Core.reviveRun(run); // the title-screen demo just carries on
      }
    }
  }

  function stepOnce() {
    const playing = G.mode === 'play';
    const held = playing ? G.held : Core.botHeld(G.run, true);
    G.eyes = held;
    handle(Core.stepRun(G.run, held, C.STEP), playing);
  }

  function updateHint() {
    G.hint = '';
    if (G.mode !== 'play' || G.save.plays >= 2 || G.run.gates >= 6) return;
    const next = Core.nextRow(G.run);
    if (next && next.y > G.run.TY - 340) G.hint = next.ca > 0 ? 'HOLD' : 'LET GO';
  }

  function ambient(sdt, dt) {
    const run = G.run;
    const live = G.mode === 'play' || G.mode === 'menu';
    const feverOn = run.fever > 0 && !run.dead;
    const moving = live || G.mode === 'dying' ? 1 : 0;
    const S = Core.speed(run.gates) * moving * (feverOn ? C.FEVER_SPEED : 1);
    G.feverK += ((feverOn ? 1 : 0) - G.feverK) * (1 - Math.exp(-8 * dt));
    G.flow = S;
    G.scroll += S * sdt;
    for (const b of G.bokeh) {
      b.y += (S * 0.12 + 6) * b.z * sdt;
      if (b.y - b.r > G.H) { b.y = -b.r; b.x = Math.random() * C.W; }
    }
    if (feverOn && live) {
      G.sparkT -= sdt;
      if (G.sparkT <= 0) {
        G.sparkT = 0.03;
        const vw = Math.max(run.twin.w, 12);
        Fx.burst(C.HALF + (Math.random() < 0.5 ? -vw : vw), run.TY, Math.random() < 0.5 ? '#FFD23F' : '#ffffff', 1, 120, 500);
      }
    }
    for (const s of G.streaks) {
      s.y += (S * 0.55 + 20) * s.z * sdt;
      if (s.y > G.H + 20) { s.y = -30; s.x = Math.random() * C.W; }
    }
    for (let i = G.trail.length - 1; i >= 0; i--) {
      const t = G.trail[i];
      t.life -= sdt;
      t.y += S * sdt;
      if (t.life <= 0) G.trail.splice(i, 1);
    }
    if (live && !run.dead) G.trail.push({ w: run.twin.w, y: run.TY, life: Render.TRAIL_LIFE });
    for (const r of run.rows) if (r.flash > 0) r.flash = Math.max(0, r.flash - dt * 4);
    G.squash = Math.max(0, G.squash - dt * 7);
    G.scorePop = Math.max(0, G.scorePop - dt * 6);
    G.gemPop = Math.max(0, G.gemPop - dt * 6);
    G.shake *= Math.exp(-10 * dt);
    G.flash *= Math.exp(-7 * dt);
    const target = feverOn ? FEVER_THEME : THEMES[G.themeIdx];
    const k = 1 - Math.exp(-(feverOn ? 9 : 3) * dt);
    for (const key of ['top', 'bot', 'block', 'rim']) {
      for (let i = 0; i < 3; i++) G.theme[key][i] += (target[key][i] - G.theme[key][i]) * k;
    }
    updateHint();
  }

  function frame(now) {
    const dt = Math.min(Math.max((now - G.last) / 1000, 0), 0.05);
    G.last = now;
    G.time += dt;
    let ts = 1;
    if (G.mode === 'dying') {
      ts = 0.25;
      G.deadT += dt * 1000;
      if (G.deadT >= CFG.DEATH_MS) finish();
    } else if (G.hitstop > 0) {
      G.hitstop -= dt;
      ts = 0.05;
    }
    const sdt = dt * ts;
    if (G.mode === 'play' || G.mode === 'menu') {
      G.acc += sdt;
      while (G.acc >= C.STEP && (G.mode === 'play' || G.mode === 'menu')) {
        stepOnce();
        G.acc -= C.STEP;
      }
    }
    ambient(sdt, dt);
    Fx.update(sdt);
    if (G.mode === 'count') tickCountdown(dt); // after stepping, so the sim starts on the next frame
    G.heldLook = G.mode === 'play' ? G.held : !!G.eyes;
    Render.draw(G);
    root.requestAnimationFrame(frame);
  }

  // ---------- input ----------
  // Which fingers and keys are down lives in `input` (see input.js); G.held is derived from it.
  let input = Input.create();
  const syncHeld = () => { G.held = G.mode === 'play' && Input.isHeld(input); };

  /** Forget every finger and key that is down. Each has to be pressed again to count. */
  function dropInput() {
    input = Input.interrupt(input);
    G.held = false;
  }

  // ---------- resume countdown ----------
  // The simulation only steps in 'play', so it stays frozen while counting.
  const countdownMs = () => CFG.COUNTDOWN_STEPS * CFG.COUNTDOWN_STEP_MS;

  function beginCountdown() {
    G.mode = 'count';
    UI.hidePause();
    // The next frame's time is measured from the last frame, not from this tap. Start below zero
    // by the time already gone since that frame, so the countdown runs from the tap itself.
    G.countMs = Math.min(0, G.last - root.performance.now());
    G.countDigit = CFG.COUNTDOWN_STEPS;
  }

  /** Advances the countdown by one frame's real time; at GO, presses still down start holding. */
  function tickCountdown(dt) {
    G.countMs += dt * 1000;
    if (G.countMs >= countdownMs()) {
      G.mode = 'play';
      G.countDigit = 0;
      syncHeld();
      return;
    }
    const elapsed = Math.max(0, G.countMs);
    G.countDigit = CFG.COUNTDOWN_STEPS - Math.floor(elapsed / CFG.COUNTDOWN_STEP_MS);
  }

  function onDown(id, primary) {
    Sfx.init();
    const locked = G.mode === 'over' && root.performance.now() - G.overAt <= CFG.OVER_LOCK_MS;
    const r = Input.down(input, id, { mode: G.mode, modal: UI.modalOpen(), locked, primary });
    if (r.action === 'start') startRun();
    else if (r.action === 'resume') beginCountdown();
    else if (r.action === 'hold' && r.first && G.mode === 'play') Sfx.press();
    input = r.state; // after startRun(), which drops older holds
    syncHeld();
  }

  function onUp(id) {
    input = Input.up(input, id);
    syncHeld();
  }

  /**
   * Focus or visibility was lost: drop every hold and pause, so the run cannot go on unattended.
   * A countdown in progress is cancelled; resuming needs a new tap and a full countdown.
   */
  function interrupt() {
    dropInput();
    if (G.mode === 'play' || G.mode === 'count') G.mode = 'ready';
    if (G.mode === 'ready') UI.showPause();
    G.countMs = 0;
    G.countDigit = 0;
  }

  const onControl = (target) => !!(target && target.closest && target.closest('button, .card'));
  const isPlayKey = (code) => code === 'Space' || code === 'ArrowUp';

  function bindInput(stage) {
    stage.addEventListener('pointerdown', (e) => {
      if (onControl(e.target)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return; // only the main button plays
      e.preventDefault();
      try {
        stage.setPointerCapture(e.pointerId); // keep receiving this pointer's release off-canvas
      } catch (err) {
        /* capture is a bonus: window-level pointerup and blur still end the hold */
      }
      onDown(Input.pointerId(e.pointerId), e.isPrimary !== false);
    });
    const pointerEnd = (e) => onUp(Input.pointerId(e.pointerId));
    root.addEventListener('pointerup', pointerEnd);
    root.addEventListener('pointercancel', pointerEnd);
    stage.addEventListener('lostpointercapture', pointerEnd);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('keydown', (e) => {
      if (e.repeat || !isPlayKey(e.code) || onControl(e.target)) return;
      e.preventDefault();
      onDown(Input.keyId(e.code), false);
    });
    root.addEventListener('keyup', (e) => {
      if (isPlayKey(e.code)) onUp(Input.keyId(e.code));
    });
    root.addEventListener('blur', interrupt);
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) interrupt();
      else dropInput();
    });
    root.addEventListener('resize', resize);
  }

  // ---------- menu actions ----------
  function share() {
    const text = 'I scored ' + G.run.score + ' in Twin Snap. Bet you can\'t beat it!';
    const full = text + ' ' + root.location.href;
    const copy = () => {
      const clip = root.navigator.clipboard;
      if (!clip || !clip.writeText) return UI.toast(text);
      return clip.writeText(full).then(() => UI.toast('Copied. Paste it to a friend.'), () => UI.toast(text));
    };
    if (root.navigator.share) {
      root.navigator.share({ title: 'Twin Snap', text, url: root.location.href }).catch((err) => {
        if (!err || err.name !== 'AbortError') copy();
      });
    } else copy();
  }

  function pickSkin(id) {
    const skin = CFG.SKINS.find((s) => s.id === id);
    if (!skin) return;
    if (G.save.owned.includes(id)) {
      G.save = Store.update(G.save, { skin: id });
      Sfx.click();
    } else if (G.save.gems >= skin.cost) {
      G.save = Store.update(G.save, { gems: G.save.gems - skin.cost, owned: G.save.owned.concat(id), skin: id });
      Sfx.buy();
      UI.toast(skin.name + ' unlocked');
    } else {
      UI.toast((skin.cost - G.save.gems) + ' more gems to unlock ' + skin.name);
      return;
    }
    G.skin = skinOf(G.save);
    UI.showShop(G.save);
  }

  const handlers = {
    onSkins() {
      G.shopFrom = G.mode === 'over' ? 'over' : 'menu';
      UI.showShop(G.save);
    },
    onCloseShop() {
      if (G.shopFrom === 'over' && G.overData) {
        G.overData = { ...G.overData, gems: G.save.gems };
        UI.showOver(G.overData);
        G.overAt = root.performance.now();
      } else UI.showMenu(G.save);
    },
    /** Shared by the title, result-card and paused sound buttons. Never changes the screen. */
    onSound() {
      G.save = Store.update(G.save, { muted: !G.save.muted });
      Sfx.muted = G.save.muted;
      UI.setSound(G.save.muted);
    },
    onRetry: startRun,
    onShare: share,
    onSkin: pickSkin,
    onRevive() {
      if (G.mode !== 'over' || G.revived) return;
      if (G.save.gems >= CFG.REVIVE_COST) {
        G.save = Store.update(G.save, { gems: G.save.gems - CFG.REVIVE_COST });
        revive();
        return;
      }
      Ads.rewarded().then((earned) => {
        if (earned && G.mode === 'over' && !G.revived) revive();
      });
    },
  };

  function boot() {
    const e = UI.mount(doc.getElementById('app'), handlers);
    UI.setSound(G.save.muted);
    G.ctx = e.canvas.getContext('2d');
    for (let i = 0; i < 34; i++) {
      G.streaks.push({ x: Math.random() * C.W, y: Math.random() * 900, z: 0.2 + Math.random() * 0.8 });
    }
    for (let i = 0; i < 9; i++) {
      G.bokeh.push({
        x: Math.random() * C.W, y: Math.random() * 900, r: 40 + Math.random() * 90,
        z: 0.3 + Math.random() * 0.7, a: 0.05 + Math.random() * 0.07,
      });
    }
    resize();
    bindInput(e.stage);
    attract();
    G.last = root.performance.now();
    root.requestAnimationFrame(frame);
  }

  TS.Game = G;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(self);
