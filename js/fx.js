/* Twin Snap — short-lived effects: sparks, rings, floating score text. */
(function (root) {
  'use strict';
  const TS = (root.TS = root.TS || {});
  const MAX_PARTICLES = 260;

  const Fx = {
    parts: [],
    rings: [],
    pops: [],
    clear() {
      this.parts.length = 0;
      this.rings.length = 0;
      this.pops.length = 0;
    },
    burst(x, y, color, count, power, gravity) {
      for (let i = 0; i < count && this.parts.length < MAX_PARTICLES; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = power * (0.35 + Math.random() * 0.65);
        const life = 0.35 + Math.random() * 0.45;
        this.parts.push({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: gravity || 0,
          life, max: life, size: 2 + Math.random() * 4, color, rot: Math.random() * 6,
        });
      }
    },
    /** Chunks thrown from a rectangle, for smashed blocks. */
    shatter(x, y, w, h, colors, count) {
      for (let i = 0; i < count && this.parts.length < MAX_PARTICLES; i++) {
        const life = 0.5 + Math.random() * 0.5;
        this.parts.push({
          x: x + Math.random() * w, y: y + Math.random() * h,
          vx: (Math.random() - 0.5) * 420, vy: -120 - Math.random() * 320, g: 900,
          life, max: life, size: 5 + Math.random() * 8, color: colors[i % colors.length], rot: Math.random() * 6,
        });
      }
    },
    confetti(width, colors) {
      for (let i = 0; i < 46 && this.parts.length < MAX_PARTICLES; i++) {
        const life = 1 + Math.random() * 0.8;
        this.parts.push({
          x: Math.random() * width, y: -10 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 200, g: 160,
          life, max: life, size: 4 + Math.random() * 5, color: colors[i % colors.length], rot: Math.random() * 6,
        });
      }
    },
    ring(x, y, color, size) {
      this.rings.push({ x, y, color, r: 6, grow: size || 220, life: 0.4, max: 0.4 });
    },
    pop(x, y, text, color, size) {
      this.pops.push({ x, y, text, color, size: size || 20, life: 0.9, max: 0.9 });
    },
    update(dt) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.life -= dt;
        if (p.life <= 0) { this.parts.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += dt * 6;
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt;
        r.r += r.grow * dt;
        if (r.life <= 0) this.rings.splice(i, 1);
      }
      for (let i = this.pops.length - 1; i >= 0; i--) {
        const p = this.pops[i];
        p.life -= dt;
        p.y -= 46 * dt;
        if (p.life <= 0) this.pops.splice(i, 1);
      }
    },
    draw(ctx, fontDisplay) {
      for (const p of this.parts) {
        const k = p.life / p.max;
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const s = p.size * (0.4 + k * 0.6);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
      for (const r of this.rings) {
        const k = r.life / r.max;
        ctx.globalAlpha = k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2 + 5 * k;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of this.pops) {
        const k = p.life / p.max;
        const grow = 1 + Math.max(0, k - 0.8) * 2.5;
        ctx.globalAlpha = Math.min(1, k * 2.5);
        ctx.font = Math.round(p.size * grow) + 'px ' + fontDisplay;
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(21,11,61,0.9)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    },
  };

  TS.Fx = Fx;
})(self);
