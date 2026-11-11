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
      e.canvas = h('canvas', { id: 'cv', 'aria-label': 'Twin Snap playfield' });

      e.best = h('span', { class: 'chip', id: 'chipBest' });
      e.gems = h('span', { class: 'chip chip-gem', id: 'chipGems' });
      e.sound = h('button', { class: 'btn btn-ghost', id: 'btnSound', type: 'button', on: click('onSound') });
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
      e.over = h('section', { class: 'screen', id: 'over', hidden: true, 'aria-label': 'Run finished' }, [
        h('div', { class: 'card' }, [
          e.overLabel, e.overScore, e.overBest, e.overGems, e.revive,
          h('button', { class: 'btn btn-sun', id: 'btnRetry', type: 'button', text: 'Play again', on: click('onRetry') }),
          h('div', { class: 'row' }, [
            h('button', { class: 'btn btn-line', id: 'btnShare', type: 'button', text: 'Challenge a friend', on: click('onShare') }),
            h('button', { class: 'btn btn-line', id: 'btnSkins2', type: 'button', text: 'Skins', on: click('onSkins') }),
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

      e.toast = h('div', { class: 'toast', id: 'toast', role: 'status', hidden: true });
      e.ad = h('div', { class: 'adph', id: 'adph', hidden: true }, [
        h('p', { class: 'adph-title', text: 'Ad break' }),
        h('p', { class: 'adph-note', text: 'Placeholder. A real rewarded ad plays here in the store build.' }),
      ]);

      e.ui = h('div', { class: 'ui' }, [e.menu, e.over, e.shop, e.toast, e.ad]);
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

    hideAll() {
      this.el.menu.hidden = true;
      this.el.over.hidden = true;
      this.el.shop.hidden = true;
    },

    showMenu(save) {
      this.hideAll();
      this.el.best.textContent = 'Best ' + save.best;
      this.el.gems.textContent = '◆ ' + save.gems;
      this.el.sound.textContent = save.muted ? 'Sound off' : 'Sound on';
      this.el.menu.hidden = false;
    },

    showOver(d) {
      this.hideAll();
      const e = this.el;
      e.overLabel.textContent = d.isBest ? 'New best!' : 'Score';
      e.overLabel.classList.toggle('is-best', d.isBest);
      e.overScore.textContent = String(d.score);
      e.overBest.textContent = d.isBest ? 'You beat ' + d.prevBest : 'Best ' + d.best + ' · ' + d.toBeat + ' to beat it';
      e.overGems.textContent = '+' + d.earned + ' ◆   (you have ' + d.gems + ')';
      e.revive.hidden = !d.canRevive;
      e.revive.textContent = d.gems >= CFG.REVIVE_COST ? 'Keep going · ◆ ' + CFG.REVIVE_COST : 'Keep going · watch ad';
      e.over.hidden = false;
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
