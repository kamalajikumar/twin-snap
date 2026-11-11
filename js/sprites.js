/* Twin Snap — character and pickup drawing, shared by the playfield and the skin shop. */
(function (root) {
  'use strict';
  const TS = (root.TS = root.TS || {});
  const INK = TS.CFG.INK;
  const TAU = Math.PI * 2;

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // Soft glow sprites are drawn once per colour and reused; canvas shadows are too slow on phones.
  const haloCache = {};
  function halo(ctx, x, y, radius, color, alpha) {
    let sprite = haloCache[color];
    if (!sprite) {
      sprite = root.document.createElement('canvas');
      sprite.width = sprite.height = 64;
      const g = sprite.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 1;
      g.fillStyle = grad;
      g.globalCompositeOperation = 'source-over';
      g.fillRect(0, 0, 64, 64);
      // fade the colour out towards the rim
      g.globalCompositeOperation = 'destination-in';
      const mask = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = mask;
      g.fillRect(0, 0, 64, 64);
      haloCache[color] = sprite;
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  function bodyPath(ctx, shape, r) {
    ctx.beginPath();
    if (shape === 'box') {
      const s = r * 0.93;
      roundRect(ctx, -s, -s, s * 2, s * 2, 5);
    } else if (shape === 'ghost') {
      ctx.arc(0, -1, r, Math.PI, 0);
      ctx.lineTo(r, r);
      for (let i = 0; i < 3; i++) {
        const x0 = r - (i * 2 * r) / 3;
        ctx.quadraticCurveTo(x0 - r / 6, r - 6, x0 - r / 3, r);
        ctx.quadraticCurveTo(x0 - r / 2, r + 4, x0 - (2 * r) / 3, r);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, TAU);
    }
  }

  function extras(ctx, shape, r, color) {
    ctx.fillStyle = shape === 'crown' ? '#FFE27A' : color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    if (shape === 'cat') {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.95, -r * 0.35);
        ctx.lineTo(s * r * 0.85, -r * 1.35);
        ctx.lineTo(s * r * 0.2, -r * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (shape === 'crown') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.75);
      ctx.lineTo(-r * 0.75, -r * 1.55);
      ctx.lineTo(-r * 0.3, -r * 1.15);
      ctx.lineTo(0, -r * 1.7);
      ctx.lineTo(r * 0.3, -r * 1.15);
      ctx.lineTo(r * 0.75, -r * 1.55);
      ctx.lineTo(r * 0.7, -r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function mouth(ctx, r, look, mood) {
    const mx = look * r * 0.12;
    const my = r * 0.42;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (mood === 'scared') {
      ctx.ellipse(mx, my + 1, r * 0.15, r * 0.2, 0, 0, TAU);
      ctx.fill();
    } else if (mood === 'grin') {
      ctx.arc(mx, my - 2, r * 0.36, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FF7B93';
      ctx.beginPath();
      ctx.arc(mx, my + 2.5, r * 0.17, 0, TAU);
      ctx.fill();
    } else {
      ctx.arc(mx, my - 3, r * 0.3, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /**
   * Draws one twin.
   * @param {number} look -1 or +1: which way it glances (towards its sibling)
   * @param {{sx?:number, sy?:number, blink?:boolean, wide?:boolean, mood?:string}} [o]
   */
  function drawTwin(ctx, x, y, r, color, shape, look, o) {
    const opt = o || {};
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(opt.sx || 1, opt.sy || 1);
    extras(ctx, shape, r, color);
    bodyPath(ctx, shape, r);
    ctx.fillStyle = color;
    ctx.fill();
    // shaded underside gives the flat colour some volume
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(21,11,61,0.16)';
    ctx.beginPath();
    ctx.arc(0, r * 1.25, r * 1.3, 0, TAU);
    ctx.fill();
    ctx.restore();
    bodyPath(ctx, shape, r);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.38, -r * 0.55, r * 0.28, r * 0.15, -0.5, 0, TAU);
    ctx.fill();

    const ex = r * 0.34;
    const ey = -r * 0.14;
    const er = r * (opt.mood === 'scared' ? 0.31 : 0.27);
    for (const s of [-1, 1]) {
      const cx = s * ex + look * r * 0.12;
      if (opt.blink) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - er, ey);
        ctx.lineTo(cx + er, ey);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, ey, er, 0, TAU);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.beginPath();
        const small = opt.wide || opt.mood === 'scared';
        ctx.arc(cx + look * er * 0.4, ey + (small ? -0.5 : 0.4), er * (small ? 0.42 : 0.55), 0, TAU);
        ctx.fill();
      }
    }
    mouth(ctx, r, look, opt.mood);
    ctx.restore();
  }

  function drawGem(ctx, x, y, spin) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.35 + 0.65 * Math.abs(Math.cos(spin)), 1);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7.5, 0);
    ctx.lineTo(0, 10);
    ctx.lineTo(-7.5, 0);
    ctx.closePath();
    ctx.fillStyle = '#FFE066';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(3.5, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCrystal(ctx, x, y, R, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    halo(ctx, x, y, R * 3, '#9BE8FF', 0.35 + pulse * 0.2);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.3 + pulse * 0.4).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, R + 6 + pulse * 4, 0, TAU);
    ctx.stroke();
    // inward chevrons: "close on me"
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const cx = x + s * (R + 22 - pulse * 6);
      ctx.beginPath();
      ctx.moveTo(cx + s * 5, y - 6);
      ctx.lineTo(cx, y);
      ctx.lineTo(cx + s * 5, y + 6);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 2) * 0.15);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.closePath();
    ctx.fillStyle = '#E9FBFF';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#9BE8FF';
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.lineTo(R * 0.87, -R / 2);
    ctx.lineTo(0, 0);
    ctx.lineTo(-R * 0.87, -R / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5CC8F0';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(R * 0.87, R / 2);
    ctx.lineTo(0, R);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  TS.Sprites = { roundRect, halo, drawTwin, drawGem, drawCrystal };
})(self);
