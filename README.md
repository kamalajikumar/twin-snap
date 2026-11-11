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
| `js/services.js` | Save data, synthesised sound, haptics, ad adapter (placeholder). |
| `js/sprites.js`, `js/render.js`, `js/fx.js` | Canvas drawing and effects. |
| `js/ui.js` | Menus. |
| `js/game.js` | Game loop, input, glue. |
| `tests/core.test.js` | Logic tests, including an autopilot that proves levels are beatable. |
| `tests/input.test.js` | Input-state tests: multi-touch, duplicates, interruptions. |
| `tests/game.input.test.js` | Runs the real scripts in a stand-in browser and fires input events at them. |
| `tools/humansim.js` | Simulated imperfect players, used to tune difficulty. |
| `tools/bundle.js` | Packs everything into one HTML file. |

## Commands

```bash
node --test tests/core.test.js tests/input.test.js tests/game.input.test.js
node tools/humansim.js ../js/core.js
node tools/bundle.js
```

## Status

Playable web prototype. Ads are a placeholder and there is no app-store build yet.
