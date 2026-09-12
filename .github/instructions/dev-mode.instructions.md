---
description: "Use when starting, launching, opening, or debugging the game locally without clicking through the setup menus. Covers the `?quickstart` dev-mode URL (skip setup wizard, jump straight into a game with developer mode enabled), the `?combatlab` battle-lab URL (pre-posed opposing units for combat testing), the `?noanim` parameter, and the dev-only console hooks (`window.__gameStore`, `window.__gameEngine`)."
---
# Dev Mode / Quick-start

The fastest way into gameplay. No menu navigation required.

## How to launch

```bash
npm run dev   # Vite dev server on http://localhost:3000
```

Then open the app with the `?quickstart` query parameter:

```
http://localhost:3000/?quickstart
```

## What `?quickstart` does

Implemented in `src/App.tsx` (search for `quickstartRef`). It:

- Skips the civilization / difficulty / map setup modal entirely.
- Immediately starts a game with these defaults:
  - **Civilization**: Germans
  - **Difficulty**: `PRINCE`
  - **Players**: `2` (`numberOfCivilizations: 2`)
  - **Map**: `NORMAL_SKIRMISH` (landMass / temperature / climate / age all `1`)
  - **`devMode: true`**
- Removes the `?quickstart` parameter from the URL after reading it (`history.replaceState`),
  so a page refresh does **not** loop back into the same start logic.

## What developer mode (`devMode: true`) changes

- **No fog of war** — every tile is visible *and* explored (`GameEngine.isVisibleToPlayer`,
  `isExploredByPlayer`, `updatePlayerVisibility`).
- **All units and cities are visible** — `getVisibleUnits` / `getVisibleCities` return
  everything.
- **Minimap shows all players** — `MiniMap` renders with `ignoreFog: true`.
- **Camera follows any unit**, including AI moves that would normally be hidden
  (`GameStore.focusOnNextUnit`, `EngineEventHandlers.isUnitVisibleToHuman`).
- **Verbose AI/perf logging** is enabled (e.g. scout zone timings, visibility updates).

Note: `mapType: 'AI_VS_AI'` / `'AI_VS_AI_SMALL'` also force `devMode: true` so the whole
map stays observable during AI-vs-AI runs.

## Related URL parameter

`?noanim` — disables all movement, combat, and camera animations (`enableAnimations: false`,
`animationSpeed: 0`, `cameraGlideSpeed: 0`). Combine with quickstart for instant, deterministic
runs:

```
http://localhost:3000/?quickstart&noanim
```

## Combat lab (`?combatlab`)

A dedicated dev/test entry point for the **fighting system**. Instead of a normal start it drops
you straight onto a small (`CLOSEUP_1V1`) map whose battlefield is already posed — no setup menu,
no unit production, no walking to the enemy:

```
http://localhost:3000/?combatlab          # play with it by hand
http://localhost:3000/?combatlab&noanim    # instant/deterministic (used by e2e)
```

Implemented in `src/App.tsx` (search for `combatLabRef`) → `GameEngine.setupCombatScenario()`
(`src/game/engine/GameEngine.ts`). It spawns three opposing pairs on adjacent, terrain-neutral
land tiles (no city/fortress/terrain defense modifiers, so outcomes are map-independent). Units
use the real `UNIT_PROPS` stats and have ids prefixed `lab_<index>_<attacker|defender>`:

| # | Attacker (civ 0) | Defender (civ 1) | Expected result |
|---|------------------|------------------|-----------------|
| 0 | Scout (attack 0.5) | Riflemen (defense 5) | Attacker may only **wound** (25%); no overrun |
| 1 | Legion (attack 3) | Warrior (defense 1) | **Decisive** overrun, attacker takes the tile |
| 2 | Cavalry (attack 5) | Archer (defense 2) | **Decisive** overrun, attacker takes the tile |

Pair 0 is the regression guard for the "a weak unit runs over a strong full-health unit" bug:
combat only overruns when the attacker's effective strength is at least the defender's, otherwise
the roll merely wears the defender down.

### The combat e2e spec

`e2e/combat.spec.ts` drives this lab. It **does not** use the `startGame()` setup-wizard helper —
it navigates directly to `/?combatlab&noanim`, waits for the `lab_*` units to exist, then calls
`window.__gameEngine.combatUnit(...)` with a pinned `Math.random` (via `page.evaluate`) so every
outcome is deterministic. It covers:

- a Scout cannot destroy a full-health Riflemen (wounded to 75%, attacker stays put);
- a stronger attacker destroys the defender and advances onto its tile;
- a second pairing resolves decisively;
- a defender-wins round damages the attacker (75%) without killing it;
- a destroyed defender is removed from the board (engine + store `UNIT_REMOVED` sync).

Run it with the `setup` gate first (see `.github/copilot-instructions.md`):

```bash
npm run test:e2e -- e2e/setup
npm run test:e2e -- e2e/combat.spec.ts
```

## Dev-only console hooks

Available when running the Vite dev server (`import.meta.env.DEV`):

- `window.__gameStore` — the Zustand game store (`src/stores/GameStore.ts`), for driving and
  inspecting game state (units, camera, dialogs, settings).
- `window.__gameEngine` — the live `GameEngine` instance (`src/App.tsx`), for inspecting units,
  combat, and movement.

## When to use it

- Debugging game-engine logic, AI behaviour, rendering, or UI issues.
- Verifying regenerated terrain/feature textures (whole map is revealed).
- Inspecting or reproducing combat behaviour with `?combatlab` (pre-posed units) — see the
  combat lab section above and `e2e/combat.spec.ts`.
- Any time you need to get into gameplay as fast as possible.

Do **not** use `?quickstart` for Playwright specs that exercise the normal start flow — those
go through the real setup wizard via the shared `startGame(page)` helper (now in
`e2e/helpers/game.ts`) and rely on the `setup` project gate. The combat spec is the deliberate
exception: it needs a prepared battlefield, so it uses `?combatlab` instead.
