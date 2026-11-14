# Twin Snap

A one-thumb arcade game for phones. Two twins are joined by a beam and the whole level is
mirrored around the centre line.

- **Hold** anywhere: the twins split apart.
- **Let go**: they snap back together.
- Thread every gate. Centre blocks need a split, side walls need a snap, gates need an exact width.
- Snap shut on a crystal to smash it and build a chain.
- Gems, close calls and crystals fill the **Fever** meter. In Fever the twins are unstoppable
  for six seconds, smash through blocks and score double.

No build step and no dependencies: open `index.html` in a browser.

## Layout

| File | Role |
| --- | --- |
| `js/core.js` | Pure game simulation: physics, level generator, scoring, Fever. No DOM. |
| `js/input.js` | Pure input state: which fingers and keys are down. No DOM. |
| `js/config.js` | Themes, skins, prices. |
| `js/services.js` | Save data, synthesised sound, haptics, ad adapter (no ad provider; offers no rewards). |
| `js/sprites.js`, `js/render.js`, `js/fx.js` | Canvas drawing and effects. |
| `js/ui.js` | Menus. |
| `js/game.js` | Game loop, input, glue. |
| `tests/core.test.js` | Logic tests, including an autopilot that proves levels are beatable. |
| `tests/input.test.js` | Input-state tests: multi-touch, duplicates, interruptions. |
| `tests/game.input.test.js` | Runs the real scripts in a stand-in browser and fires input events at them. |
| `tests/store.test.js` | Save storage: load and write status, corrupt-save backup, failure injection. |
| `tests/game.save.test.js` | What the player sees and keeps when saving fails. |
| `tests/game.tabs.test.js` | Several open tabs sharing one save. |
| `tests/game.revive.test.js` | The gem-paid revive: price, stale balances, save failures, no ad-funded revive. |
| `tests/helpers/world.js` | The shared stand-in browser, fake storage and multi-tab event bus used by the tests. |
| `tools/humansim.js` | Simulated imperfect players, used to tune difficulty. |
| `tools/bundle.js` | Packs everything into one HTML file. |

## Commands

```bash
node --test tests/core.test.js tests/input.test.js tests/game.input.test.js tests/store.test.js tests/game.save.test.js tests/game.tabs.test.js tests/game.revive.test.js
node tools/humansim.js ../js/core.js
node tools/bundle.js
```

## Saving and several open tabs

Progress is saved in `localStorage` under `twin-snap-save-v1`. Each save carries `rev`, a write
counter (older saves have none and read as 0).

A tab never writes its own copy of the save. It re-reads the latest stored save and applies its
change to it: a finished run adds its gems and keeps the higher best score, a purchase is checked
against the latest balance, and so on. Changes that cannot be saved yet stay queued in that tab and
are applied, once, by its next successful save. When another tab saves, open tabs re-read the save
and update what they show.

What this guarantees:

- A tab that has not seen another tab's changes cannot undo them by writing an old copy.
- The best score and owned skins never go down; a skin is never charged twice.
- A purchase is saved completely or not at all.
- A revive costs 20 gems, checked against the latest saved balance. It is granted only after the
  payment is saved; if the payment is refused or cannot be saved, nothing is charged or granted.
- Damaged save data is never overwritten; a tab that finds it says so and keeps playing.

What it cannot guarantee: `localStorage` has no atomic compare-and-swap.

- **Race detected before writing.** Just before writing, a tab re-reads the save. If another tab
  wrote in the meantime, it starts again from the new save (up to three attempts), so nothing is
  lost.
- **Race after the final check.** If another tab writes after that last re-read and before this
  tab's write lands, this tab's write replaces it and that other change is lost. It needs two
  writes within moments of each other, and cannot be prevented without a browser lock. This also
  applies to purchases and revive payments: one of the two writes can be lost.

A tab running an older build still writes its whole copy and can overwrite newer progress, and
still offers its old placeholder ad revive.

## Status

Playable web prototype. There are no ads: no ad provider is integrated, so no ad rewards are
offered. There is no app-store build yet.
