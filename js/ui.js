/* Twin Snap — menus drawn with DOM on top of the canvas. All text goes through textContent. */
(function (root) {
  'use strict';
  const TS = (root.TS = root.TS || {});
  const CFG = TS.CFG;
  const doc = root.document;

  function h(tag, attrs, kids) {
    const el = doc.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach((k) => {
      if (k === 'text') el.textContent = a[k];
      else if (k === 'on') Object.keys(a.on).forEach((ev) => el.addEventListener(ev, a.on[ev]));
      else if (k === 'hidden') el.hidden = a[k];
      else el.setAttribute(k, a[k]);
    });
    (kids || []).forEach((c) => el.appendChild(c));
    return el;
  }

  const UI = {
    el: {},
    handlers: {},
    toastTimer: 0,

    mount(app, handlers) {
      this.handlers = handlers;
      const click = (name) => ({
        click: () => {
          TS.Sfx.init();
          TS.Sfx.click();
          handlers[name]();
        },
      });
      const e = this.el;
      /*
       * Sound buttons share one handler. A click whose screen is already hidden is ignored: a
       * press can begin on a button that is hidden before the finger lifts (another finger
       * resumed the game), and some browsers still deliver that click to the hidden button.
       * A pointer click also lets go of focus, so Space keeps playing instead of toggling.
       */
      const soundClick = (screen) => ({
        click: (ev) => {
          if (screen().hidden) return;
          TS.Sfx.init();
          TS.Sfx.click();
          handlers.onSound();
          if (ev && ev.detail > 0 && ev.currentTarget && ev.currentTarget.blur) ev.currentTarget.blur();
        },
      });
      const soundButton = (id, cls, screen) => h('button', { class: 'btn ' + cls, id, type: 'button', on: soundClick(screen) });
      e.canvas = h('canvas', { id: 'cv', 'aria-label': 'Twin Snap playfield' });

      e.best = h('span', { class: 'chip', id: 'chipBest' });
      e.gems = h('span', { class: 'chip chip-gem', id: 'chipGems' });
      e.sound = soundButton('btnSound', 'btn-ghost', () => e.menu);
      // Says when progress is not being saved; the same text on the title and the result card.
      const saveNote = () => h('p', { class: 'save-note', role: 'status', hidden: true });
      e.saveNoteMenu = saveNote();
      e.saveNoteOver = saveNote();
      e.menu = h('section', { class: 'screen', id: 'menu', 'aria-labelledby': 'logo' }, [
        h('h1', { class: 'logo', id: 'logo' }, [
          h('span', { class: 'logo-a', text: 'TWIN' }),
          h('span', { class: 'logo-b', text: 'SNAP' }),
        ]),
        h('div', { class: 'group' }, [
          h('p', { class: 'tag', text: 'Hold to split. Let go to snap.' }),
          h('p', { class: 'tag tag-small', text: 'Fill the meter for FEVER and smash everything.' }),
          h('p', { class: 'start', text: 'Hold anywhere to play' }),
        ]),
        h('div', { class: 'group' }, [
          h('div', { class: 'chips' }, [e.best, e.gems]),
          e.saveNoteMenu,
          h('div', { class: 'row' }, [
            h('button', { class: 'btn btn-ghost', id: 'btnSkins', type: 'button', text: 'Skins', on: click('onSkins') }),
            e.sound,
          ]),
        ]),
      ]);

      e.overLabel = h('p', { class: 'over-label' });
      e.overScore = h('p', { class: 'over-score' });
      e.overBest = h('p', { class: 'over-best' });
      e.overGems = h('p', { class: 'over-gems' });
      e.revive = h('button', { class: 'btn btn-mint', id: 'btnRevive', type: 'button', on: click('onRevive') });
      e.overSound = soundButton('btnSoundOver', 'btn-line', () => e.over);
      e.over = h('section', { class: 'screen', id: 'over', hidden: true, 'aria-label': 'Run finished' }, [
        h('div', { class: 'card' }, [
          e.overLabel, e.overScore, e.overBest, e.overGems, e.saveNoteOver, e.revive,
          h('button', { class: 'btn btn-sun', id: 'btnRetry', type: 'button', text: 'Play again', on: click('onRetry') }),
          h('div', { class: 'row' }, [
            h('button', { class: 'btn btn-line', id: 'btnShare', type: 'button', text: 'Challenge a friend', on: click('onShare') }),
            h('button', { class: 'btn btn-line', id: 'btnSkins2', type: 'button', text: 'Skins', on: click('onSkins') }),
            e.overSound,
          ]),
        ]),
        h('p', { class: 'over-tip', text: 'or tap anywhere to go again' }),
      ]);

      e.shopGems = h('p', { class: 'shop-gems' });
      e.grid = h('div', { class: 'grid' });
      e.shop = h('section', { class: 'screen', id: 'shop', hidden: true, 'aria-labelledby': 'shopTitle' }, [
        h('div', { class: 'card card-wide' }, [
          h('h2', { id: 'shopTitle', class: 'shop-title', text: 'Skins' }),
          e.shopGems,
          e.grid,
          h('button', { class: 'btn btn-sun', id: 'btnShopClose', type: 'button', text: 'Done', on: click('onCloseShop') }),
        ]),
      ]);

      // PAUSED and TAP TO RESUME are drawn on the canvas; this layer only adds the sound toggle.
      e.pauseSound = soundButton('btnSoundPause', 'btn-ghost', () => e.pause);
      e.pause = h('section', { class: 'screen', id: 'pause', hidden: true, 'aria-label': 'Paused' }, [e.pauseSound]);

      e.toast = h('div', { class: 'toast', id: 'toast', role: 'status', hidden: true });
      e.ad = h('div', { class: 'adph', id: 'adph', hidden: true }, [
        h('p', { class: 'adph-title', text: 'Ad break' }),
        h('p', { class: 'adph-note', text: 'Placeholder. A real rewarded ad plays here in the store build.' }),
      ]);

      e.ui = h('div', { class: 'ui' }, [e.menu, e.over, e.shop, e.pause, e.toast, e.ad]);
      e.stage = h('div', { class: 'stage', id: 'stage' }, [e.canvas, e.ui]);
      app.appendChild(e.stage);

      TS.Ads.placeholder = () =>
        new Promise((resolve) => {
          e.ad.hidden = false;
          root.setTimeout(() => {
            e.ad.hidden = true;
            resolve(true);
          }, 1400);
        });
      return e;
    },

    modalOpen() {
      return !this.el.shop.hidden || !this.el.ad.hidden;
    },

    /** Hides a screen, first moving keyboard focus off it so Space cannot reach a hidden button. */
    hide(screen) {
      const active = doc.activeElement;
      if (active && active !== screen && screen.contains(active) && active.blur) active.blur();
      screen.hidden = true;
    },

    hideAll() {
      [this.el.menu, this.el.over, this.el.shop, this.el.pause].forEach((s) => this.hide(s));
    },

    /** Shows the same sound state on every sound button. aria-pressed is true while sound is on. */
    setSound(muted) {
      [this.el.sound, this.el.overSound, this.el.pauseSound].forEach((b) => {
        b.textContent = muted ? 'Sound off' : 'Sound on';
        b.setAttribute('aria-pressed', String(!muted));
      });
    },

    /** @param {string|null} text why progress is not being saved, or null to hide the note */
    setSaveNote(text) {
      [this.el.saveNoteMenu, this.el.saveNoteOver].forEach((p) => {
        p.textContent = text || '';
        p.hidden = !text;
      });
    },

    showPause() { this.el.pause.hidden = false; },
    /** @param {number} y centre of the paused sound toggle, CSS px from the top of the stage */
    placePause(y) { this.el.pause.style.top = y + 'px'; },
    hidePause() { this.hide(this.el.pause); },

    showMenu(save) {
      this.hideAll();
      this.fillMenu(save);
      this.setSound(save.muted);
      this.el.menu.hidden = false;
    },

    fillMenu(save) {
      this.el.best.textContent = 'Best ' + save.best;
      this.el.gems.textContent = '◆ ' + save.gems;
    },

    showOver(d) {
      this.hideAll();
      this.fillOver(d);
      this.el.over.hidden = false;
    },

    /**
     * Updates every screen that shows saved values, without opening or closing any screen
     * (used when another tab saved). `overData` is the result card's data, if there is one.
     */
    refreshSave(save, overData) {
      this.fillMenu(save);
      if (overData) this.fillOver(overData);
      if (!this.el.shop.hidden) this.showShop(save);
    },

    fillOver(d) {
      const e = this.el;
      e.overLabel.textContent = d.isBest ? 'New best!' : 'Score';
      e.overLabel.classList.toggle('is-best', d.isBest);
      e.overScore.textContent = String(d.score);
      e.overBest.textContent = d.isBest ? 'You beat ' + d.prevBest : 'Best ' + d.best + ' · ' + d.toBeat + ' to beat it';
      e.overGems.textContent = '+' + d.earned + ' ◆   (you have ' + d.gems + ')';
      e.revive.hidden = !d.canRevive;
      e.revive.textContent = d.gems >= CFG.REVIVE_COST ? 'Keep going · ◆ ' + CFG.REVIVE_COST : 'Keep going · watch ad';
    },

    showShop(save) {
      const e = this.el;
      e.menu.hidden = true;
      e.over.hidden = true;
      e.shopGems.textContent = '◆ ' + save.gems + '   Collect gems in play to unlock more.';
      e.grid.textContent = '';
      CFG.SKINS.forEach((skin) => {
        const owned = save.owned.includes(skin.id);
        const worn = save.skin === skin.id;
        const cv = h('canvas', { width: '168', height: '84', class: 'skin-cv' });
        const ctx = cv.getContext('2d');
        ctx.scale(2, 2);
        ctx.strokeStyle = 'rgba(21,11,61,0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(24, 24);
        ctx.lineTo(60, 24);
        ctx.stroke();
        TS.Sprites.drawTwin(ctx, 24, 24, 13, skin.a, skin.shape, 1);
        TS.Sprites.drawTwin(ctx, 60, 24, 13, skin.b, skin.shape, -1);
        const status = worn ? 'Wearing' : owned ? 'Wear' : '◆ ' + skin.cost;
        const cls = 'skin' + (worn ? ' is-worn' : '') + (!owned && save.gems < skin.cost ? ' is-locked' : '');
        e.grid.appendChild(
          h('button', {
            class: cls, type: 'button', id: 'skin-' + skin.id,
            on: { click: () => { TS.Sfx.init(); this.handlers.onSkin(skin.id); } },
          }, [cv, h('span', { class: 'skin-name', text: skin.name }), h('span', { class: 'skin-status', text: status })])
        );
      });
      e.shop.hidden = false;
    },

    toast(text) {
      const t = this.el.toast;
      t.textContent = text;
      t.hidden = false;
      root.clearTimeout(this.toastTimer);
      this.toastTimer = root.setTimeout(() => { t.hidden = true; }, 2600);
    },
  };

  TS.UI = UI;
})(self);
