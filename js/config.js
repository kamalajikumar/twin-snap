/* Twin Snap — tunables that are about presentation and economy, not physics. */
(function (root) {
  'use strict';
  const TS = (root.TS = root.TS || {});

  TS.CFG = Object.freeze({
    // The world recolours every 10 gates so progress is visible at a glance.
    THEMES: Object.freeze([
      { top: '#24135F', bot: '#7B2CBF', block: '#130A3A', rim: '#B9A0FF' },
      { top: '#08324F', bot: '#0E9AA0', block: '#051E2E', rim: '#86FFE6' },
      { top: '#571036', bot: '#EC5A3C', block: '#2B071E', rim: '#FFC7AD' },
      { top: '#0F3320', bot: '#5FB02B', block: '#081C10', rim: '#DCFF9E' },
      { top: '#17172B', bot: '#E2457F', block: '#0B0B18', rim: '#FFA3C8' },
      { top: '#452600', bot: '#EDA200', block: '#261500', rim: '#FFE7A3' },
    ]),
    FEVER_THEME: Object.freeze({ top: '#FF2E7E', bot: '#FFB000', block: '#4A0B33', rim: '#FFFFFF' }),
    CONFETTI: Object.freeze(['#FFD23F', '#3BF4C7', '#FF5D73', '#9BE8FF', '#FFFFFF']),
    SKINS: Object.freeze([
      { id: 'classic', name: 'Pip & Pop', cost: 0, a: '#FFD23F', b: '#3BF4C7', shape: 'orb' },
      { id: 'gum', name: 'Bubblegum', cost: 30, a: '#FF7BAC', b: '#7BD3FF', shape: 'orb' },
      { id: 'blox', name: 'Blox', cost: 60, a: '#FF8A3D', b: '#B98BFF', shape: 'box' },
      { id: 'kit', name: 'Kit & Kat', cost: 120, a: '#FFF3E0', b: '#FFB26B', shape: 'cat' },
      { id: 'boo', name: 'Boo Crew', cost: 200, a: '#F4F1FF', b: '#C9F7FF', shape: 'ghost' },
      { id: 'royal', name: 'Royals', cost: 350, a: '#FFC93C', b: '#FF6B8B', shape: 'crown' },
    ]),
    PRAISE: Object.freeze(['NICE!', 'SMOOTH!', 'ON FIRE!', 'WILD!', 'UNREAL!', 'LEGEND!']),
    REVIVE_COST: 20,
    OVER_LOCK_MS: 450, // ignore taps right after the result card appears
    DEATH_MS: 800,
    COUNTDOWN_STEPS: 3, // resuming shows 3, 2, 1
    COUNTDOWN_STEP_MS: 500, // how long each number stays up
    INK: '#150B3D',
    FONT_DISPLAY: 'Bungee, "Arial Black", Impact, sans-serif',
    FONT_BODY: 'Fredoka, "Trebuchet MS", system-ui, sans-serif',
  });
})(self);
