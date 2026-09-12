---
description: "Use when starting, launching, opening, or debugging the game locally without clicking through the setup menus. Covers the `?quickstart` dev-mode URL (skip setup wizard, jump straight into a game with developer mode enabled), the `?noanim` parameter, and the dev-only console hooks (`window.__gameStore`, `window.__gameEngine`)."
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

## Dev-only console hooks

Available when running the Vite dev server (`import.meta.env.DEV`):

- `window.__gameStore` — the Zustand game store (`src/stores/GameStore.ts`), for driving and
  inspecting game state (units, camera, dialogs, settings).
- `window.__gameEngine` — the live `GameEngine` instance (`src/App.tsx`), for inspecting units,
  combat, and movement.

## When to use it

- Debugging game-engine logic, AI behaviour, rendering, or UI issues.
- Verifying regenerated terrain/feature textures (whole map is revealed).
- Any time you need to get into gameplay as fast as possible.

Do **not** use `?quickstart` for Playwright specs — the e2e suite navigates the real setup
wizard via the shared `startGame(page)` helper with the `CLOSEUP_1V1` map preset and relies on
the `setup` project gate.
