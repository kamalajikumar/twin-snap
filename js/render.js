/* Twin Snap — playfield renderer. Reads game state, never changes it. */
(function (root) {
  'use strict';
  const TS = (root.TS = root.TS || {});
  const { C } = TS.Core;
  const CFG = TS.CFG;
  const S = TS.Sprites;
  const INK = CFG.INK;
  const TAU = Math.PI * 2;
  const TRAIL_LIFE = 0.34;
  // Paused screen, as offsets from the twin line: PAUSED (and the 3-2-1 digits), the sound toggle
  // (a DOM button that game.js places), and TAP TO RESUME. title matches 0.42 * H at H=640.
  const PAUSE = Object.freeze({ title: -205, toggle: -98, pill: 64 });

  const rgb = (c) => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';

  function drawBackground(ctx, G) {
    const th = G.theme;
    const grad = ctx.createLinearGradient(0, 0, 0, G.H);
    grad.addColorStop(0, rgb(th.top));
    grad.addColorStop(1, rgb(th.bot));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, C.W, G.H);

    for (const b of G.bokeh) S.halo(ctx, b.x, b.y, b.r, '#ffffff', b.a);

    if (G.feverK > 0.01) {
      // rotating sunburst behind the twins while fever is on
      ctx.save();
      ctx.translate(C.HALF, G.run.TY);
      ctx.rotate(G.time * 0.7);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.07 * G.feverK).toFixed(3) + ')';
      for (let i = 0; i < 10; i++) {
        ctx.rotate(TAU / 10);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-70, -900);
        ctx.lineTo(70, -900);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.fillStyle = '#fff';
    const stretch = 8 + G.flow * 0.07 * (1 + G.feverK * 1.5);
    for (const s of G.streaks) {
      ctx.globalAlpha = 0.04 + s.z * (0.1 + G.feverK * 0.12);
      ctx.fillRect(s.x, s.y, 1 + s.z * 1.6, stretch * (0.4 + s.z));
    }
    // centre seam and edge chevrons scroll with the world: they are the speedometer
    ctx.globalAlpha = 0.12;
    for (let y = ((G.scroll * 0.5) % 28) - 28; y < G.H; y += 28) ctx.fillRect(C.HALF - 1, y, 2, 12);
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = (G.scroll % 44) - 44; y < G.H; y += 44) {
      ctx.moveTo(4, y);
      ctx.lineTo(9, y + 6);
      ctx.lineTo(14, y);
      ctx.moveTo(C.W - 4, y);
      ctx.lineTo(C.W - 9, y + 6);
      ctx.lineTo(C.W - 14, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // One slab. `capL` / `capR` mark the ends that face the gap: those glow as the danger edge.
  function slab(ctx, x, y, w, h, fill, rim, capL, capR) {
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    S.roundRect(ctx, x, y + 7, w, h, 9);
    ctx.fill();
    ctx.fillStyle = fill;
    S.roundRect(ctx, x, y, w, h, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    S.roundRect(ctx, x + 4, y + 4, w - 8, Math.min(6, h / 3), 3);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = rim;
    S.roundRect(ctx, x, y, w, h, 9);
    ctx.stroke();
    ctx.fillStyle = rim;
    if (capL) {
      S.halo(ctx, x, y + h / 2, 20, '#ffffff', 0.3);
      S.roundRect(ctx, x, y, 7, h, 4);
      ctx.fill();
    }
    if (capR) {
      S.halo(ctx, x + w, y + h / 2, 20, '#ffffff', 0.3);
      S.roundRect(ctx, x + w - 7, y, 7, h, 4);
      ctx.fill();
    }
  }

  function drawRecordFlag(ctx, r) {
    const y = r.y - 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(C.W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    pill(ctx, 'YOUR BEST', 62, y, 11, INK, '#ffffff');
  }

  function drawRows(ctx, G) {
    const fill = rgb(G.theme.block);
    const themeRim = rgb(G.theme.rim);
    for (const r of G.run.rows) {
      if (r.y > G.H + 30 || r.y + r.h < -30) continue;
      if (r.n === G.recordGate && !r.passed) drawRecordFlag(ctx, r);
      if (r.broken) continue;
      const rim = r.osc ? '#FFD23F' : themeRim;
      const hasCore = r.ca > 0;
      const hasSides = r.cb < C.HALF;
      const sideW = C.HALF - r.cb + 30;
      if (hasCore) slab(ctx, C.HALF - r.ca, r.y, r.ca * 2, r.h, fill, rim, true, true);
      if (hasSides) {
        slab(ctx, -30, r.y, sideW, r.h, fill, rim, false, true);
        slab(ctx, C.HALF + r.cb, r.y, sideW, r.h, fill, rim, true, false);
      }
      if (r.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + (r.flash * 0.55).toFixed(3) + ')';
        if (hasCore) { S.roundRect(ctx, C.HALF - r.ca, r.y, r.ca * 2, r.h, 9); ctx.fill(); }
        if (hasSides) {
          S.roundRect(ctx, -30, r.y, sideW, r.h, 9);
          ctx.fill();
          S.roundRect(ctx, C.HALF + r.cb, r.y, sideW, r.h, 9);
          ctx.fill();
        }
      }
    }
  }

  function drawPicks(ctx, G) {
    for (const p of G.run.picks) {
      if (p.y < -40 || p.y > G.H + 40) continue;
      if (p.type === 'gem') {
        const spin = p.spin + G.time * 4;
        const bob = Math.sin(G.time * 5 + p.spin) * 2;
        S.halo(ctx, C.HALF - p.g, p.y, 20, '#FFE066', 0.45);
        S.halo(ctx, C.HALF + p.g, p.y, 20, '#FFE066', 0.45);
        S.drawGem(ctx, C.HALF - p.g, p.y + bob, spin);
        S.drawGem(ctx, C.HALF + p.g, p.y + bob, spin);
      } else {
        S.drawCrystal(ctx, C.HALF, p.y, C.CRYSTAL_R, G.time + p.spin);
      }
    }
  }

  // The trail is a tapering ribbon per twin; it draws the shape of your last half second.
  function drawTrail(ctx, G, color, side) {
    const tr = G.trail;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1];
      const b = tr[i];
      const k = b.life / TRAIL_LIFE;
      ctx.globalAlpha = k * 0.42;
      ctx.lineWidth = C.R * 1.7 * k;
      ctx.beginPath();
      ctx.moveTo(C.HALF + side * Math.max(a.w, 12), a.y);
      ctx.lineTo(C.HALF + side * Math.max(b.w, 12), b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  function drawBeam(ctx, G, xl, xr, y, stretch) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(xl, y);
    if (G.feverK > 0.5) {
      const n = 7;
      for (let i = 1; i < n; i++) ctx.lineTo(xl + ((xr - xl) * i) / n, y + (Math.random() - 0.5) * 16 * stretch - 0);
      ctx.lineTo(xr, y);
    } else {
      ctx.quadraticCurveTo(C.HALF, y + Math.sin(G.time * 9) * 4 * stretch, xr, y);
    }
    ctx.strokeStyle = G.feverK > 0.5 ? 'rgba(255,226,122,0.35)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5 - 3 * stretch;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function moodOf(G) {
    if (G.feverK > 0.5) return 'grin';
    const next = TS.Core.nextRow(G.run);
    if (next && !next.broken && next.y + next.h > G.run.TY - 95 && TS.Core.clearance(next, G.run.twin.w) < 8) {
      return 'scared';
    }
    return 'smile';
  }

  function drawTwins(ctx, G) {
    const run = G.run;
    const skin = G.skin;
    const tw = run.twin;
    const y = run.TY;
    drawTrail(ctx, G, skin.a, -1);
    drawTrail(ctx, G, skin.b, 1);
    if (run.dead) return;
    const vw = Math.max(tw.w, 12); // closed twins sit cheek to cheek instead of overlapping
    const xl = C.HALF - vw;
    const xr = C.HALF + vw;
    const fever = G.feverK;
    const glow = fever > 0.5 ? '#FFE27A' : null;
    const haloR = C.R * (2.6 + fever * 1.6 + Math.sin(G.time * 12) * 0.2 * fever);
    S.halo(ctx, xl, y, haloR, glow || skin.a, 0.55 + fever * 0.3);
    S.halo(ctx, xr, y, haloR, glow || skin.b, 0.55 + fever * 0.3);
    drawBeam(ctx, G, xl, xr, y, tw.w / C.W_MAX);
    const sq = G.squash;
    const speedStretch = Math.min(Math.abs(tw.v) / 3200, 0.22);
    const grow = 1 + fever * 0.22;
    const o = {
      sx: (1 - sq * 0.3 + speedStretch) * grow,
      sy: (1 + sq * 0.3 - speedStretch) * grow,
      blink: G.time % 3.4 < 0.12 || sq > 0.5,
      wide: G.heldLook,
      mood: moodOf(G),
    };
    S.drawTwin(ctx, xl, y, C.R, skin.a, skin.shape, 1, o);
    S.drawTwin(ctx, xr, y, C.R, skin.b, skin.shape, -1, o);
  }

  function pill(ctx, text, x, y, size, fg, bg) {
    ctx.font = size + 'px ' + CFG.FONT_DISPLAY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + size * 1.3;
    const h = size * 1.75;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    S.roundRect(ctx, x - w / 2, y - h / 2 + 4, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = bg;
    S.roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.fillText(text, x, y + size * 0.06);
  }

  function drawMeter(ctx, G) {
    const run = G.run;
    const on = run.fever > 0;
    const k = on ? run.fever / C.FEVER_TIME : run.charge;
    const w = 104;
    const x = C.HALF - w / 2;
    const y = 122;
    ctx.fillStyle = 'rgba(21,11,61,0.55)';
    S.roundRect(ctx, x - 3, y - 3, w + 6, 16, 8);
    ctx.fill();
    if (k > 0.01) {
      const pulse = !on && k > 0.75 ? 0.75 + 0.25 * Math.sin(G.time * 14) : 1;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = on ? '#FFD23F' : '#9BE8FF';
      S.roundRect(ctx, x, y, Math.max(10, w * k), 10, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (on) {
      const blink = run.fever < 1.5 && Math.floor(G.time * 8) % 2 === 0;
      ctx.font = Math.round(17 + Math.sin(G.time * 10) * 1.5) + 'px ' + CFG.FONT_DISPLAY;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.strokeText('FEVER ×2', C.HALF, y + 30);
      ctx.fillStyle = blink ? '#ffffff' : '#FFD23F';
      ctx.fillText('FEVER ×2', C.HALF, y + 30);
    } else if (run.chain > 1) {
      ctx.font = '14px ' + CFG.FONT_DISPLAY;
      ctx.fillStyle = '#9BE8FF';
      ctx.fillText('SNAP CHAIN ×' + run.chain, C.HALF, y + 28);
    }
  }

  function drawHud(ctx, G) {
    const run = G.run;
    if (G.mode === 'menu') return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = Math.round(60 * (1 + G.scorePop * 0.28));
    ctx.font = size + 'px ' + CFG.FONT_DISPLAY;
    ctx.fillStyle = 'rgba(21,11,61,0.55)';
    ctx.fillText(String(run.score), C.HALF + 3, 78 + 5);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(run.score), C.HALF, 78);
    drawMeter(ctx, G);

    S.drawGem(ctx, C.W - 62, 32, 0);
    ctx.textAlign = 'left';
    ctx.font = '600 ' + Math.round(19 * (1 + G.gemPop * 0.3)) + 'px ' + CFG.FONT_BODY;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(G.save.gems + run.gems - G.banked), C.W - 48, 33);

    if (G.mode === 'ready') {
      bigText(ctx, 'PAUSED', run.TY + PAUSE.title, 44);
      pill(ctx, 'TAP TO RESUME', C.HALF, run.TY + PAUSE.pill, 16, INK, '#FFD23F');
    } else if (G.mode === 'count' && G.countDigit > 0) {
      bigText(ctx, String(G.countDigit), run.TY + PAUSE.title, 96);
    } else if (G.mode === 'play' && G.hint) {
      pill(ctx, G.hint, C.HALF, run.TY + 64, 20, INK, G.hint === 'HOLD' ? '#FFD23F' : '#3BF4C7');
    }
  }

  /** Large centred display text with the same drop shadow as the score. */
  function bigText(ctx, text, y, size) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = size + 'px ' + CFG.FONT_DISPLAY;
    ctx.fillStyle = 'rgba(21,11,61,0.55)';
    ctx.fillText(text, C.HALF + 3, y + 5);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, C.HALF, y);
  }

  function drawVignette(ctx, G) {
    const grad = ctx.createRadialGradient(C.HALF, G.H * 0.5, G.H * 0.3, C.HALF, G.H * 0.5, G.H * 0.75);
    grad.addColorStop(0, 'rgba(10,4,32,0)');
    grad.addColorStop(1, 'rgba(10,4,32,0.42)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, C.W, G.H);
  }

  function draw(G) {
    const ctx = G.ctx;
    const k = G.dpr * G.scale;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawBackground(ctx, G);
    ctx.save();
    if (G.shake > 0.2) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    drawRows(ctx, G);
    drawPicks(ctx, G);
    drawTwins(ctx, G);
    TS.Fx.draw(ctx, CFG.FONT_DISPLAY);
    ctx.restore();
    drawVignette(ctx, G);
    if (G.mode === 'menu' || G.mode === 'ready' || G.mode === 'count') {
      ctx.fillStyle = 'rgba(21,11,61,0.38)'; // dim the playfield behind menus, pause and countdown
      ctx.fillRect(0, 0, C.W, G.H);
    }
    drawHud(ctx, G);
    if (G.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + G.flash.toFixed(3) + ')';
      ctx.fillRect(0, 0, C.W, G.H);
    }
  }

  TS.Render = { draw, TRAIL_LIFE, PAUSE };
})(self);
