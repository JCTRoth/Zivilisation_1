---
description: "Use when changing unit selection, movement mode, the map cursor, hover previews, reachable-tile overlays, GoTo/path assignment, path turn numbers, or the unit right-click context menu (ORDERS). Documents the control model: selectedUnit as the single source of truth, hover behaviour, click/right-click semantics, and the movement-preview helpers."
applyTo: ["src/components/game/GameCanvas.tsx", "src/game/rendering/MapRenderer.ts", "src/utils/MovementPreview.ts", "src/game/engine/GoToManager.ts", "src/game/engine/Pathfinding.ts"]
---
# Unit Controls & Movement Mode

How the mouse/keyboard controls for units are meant to behave. Keep these rules
in sync when editing selection, cursor, hover, pathing or the ORDERS menu.

Manual check: open `http://localhost:3000/?quickstart` (see the dev-mode
instruction) to jump straight into a game with the map revealed.

## Single source of truth

`gameState.selectedUnit` (Zustand store) is the **only** source of selection
state. Never add a parallel local "goto mode" flag — that divergence was the
original bug (auto-selected units showed their range but kept the default
cursor, and the first right-click only exited the phantom mode).

Derived in `GameCanvas.tsx`:

```ts
const selectedUnit = useMemo(...);                       // id -> Unit
const isUnitSelectionMode =
  !!selectedUnit &&
  selectedUnit.civilizationId === HUMAN_PLAYER_ID &&     // 0
  gameState.activePlayer === HUMAN_PLAYER_ID;
```

Everything keys off this:

- **Cursor** — `crosshair` while `isUnitSelectionMode`, else `grab`/`grabbing`.
- **Movement range** — the effect on `gameState.selectedUnit` computes
  `Pathfinding.getReachableTiles(...)`. Auto-selection (turn queue,
  `focusOnNextUnit`, unit-moved events) goes through the same effect, so it
  behaves exactly like a manual click.
- **Left-drag panning is disabled** while a unit is selected (drag otherwise
  fires a click on mouse-up and would issue a move order).

## Hover behaviour

`handleMouseMove` recomputes only when the hovered hex or the relevant unit
state changes (guarded by `lastHoverKeyRef`; per-unit results cached in
`reachableCacheRef`).

**Hover state is deliberately NOT React state.** `hoveredHex`, `hoverReachable`,
`previewPath` and `previewTurnMarkers` live in refs
(`hoveredHexRef`, `hoverReachableRef`, `previewPathRef`,
`previewTurnMarkersRef`) and `handleMouseMove` only sets
`needsRender.current = true`. The single render loop in `GameCanvas` reads the
refs and composites. Routing a hover through `useState` re-rendered the whole
component and rebuilt the map on every mouse move — do not reintroduce that.

The shortest-path preview is **deferred** (`setTimeout(…, 0)` into
`previewTimerRef`): the hovered-tile outline is drawn immediately, and only the
tile the pointer comes to rest on runs `computeMovementPreview` (A*). Sweeping
the mouse therefore never runs A* for intermediate tiles. A new hover cancels
any pending computation, and the callback re-checks `lastHoverKeyRef` before
painting (so a stale result is never shown).

1. **Hover a visible unit** → show that unit's movement range.
   - Own units, or enemy/AI units on a visible tile (`isUnitVisibleToHuman`);
     `devMode` reveals everything.
   - The renderer colours the overlay from `reachableUnitType` (land = blue,
     naval = red), falling back to the selected unit.
2. **Hover any tile** → it is outlined (subtle white) so the player can see the
   exact field under the mouse.
3. **Unit selected + hover a non-unit tile** → show the **shortest path** to that
   tile (dashed yellow polyline + destination ring) computed with
   `computeMovementPreview(...)` from `src/utils/MovementPreview.ts`.
   - Tiles the human has not explored are not connected.
   - No path (e.g. ocean for a land unit) → no preview.
4. **Multi-turn destinations** → draw **turn numbers** on the hovered path
   (`previewTurnMarkers`): the tile where turn 1 ends, turn 2 ends, … and the
   target. No numbers when the whole path fits in one turn.
5. `onMouseLeave` clears all hover state and cancels a pending preview timer.

`handleMouseMove` must also use the cached canvas rect
(`canvasRectRef` + `syncCanvasRect`) rather than calling
`getBoundingClientRect()` per event — the latter forces a synchronous layout on
every mouse move.

## Click semantics (`handleClick`)

Order of resolution matters: **unit → enemy → move (selection mode) → city → empty.**

| Action | Result |
| --- | --- |
| Left-click own unit (not selected) | Select it → movement mode |
| Left-click the **already selected** unit | Cancel its assigned GoTo path; **stay selected** (no-op if no path). Never deselects. |
| Left-click a destination (unit selected) | Assign a GoTo path; the unit moves as far as it can this turn and continues on later turns |
| Left-click an adjacent enemy | Attack (`moveAnimator.attack`) |
| Left-click a city (no unit selected) | Select the city + open city details |
| Left-click the same **empty** hex twice | Clear selection (guarded by `!unitAt`) |

While a unit is selected, a click issues a move **even on a city tile** (movement
takes precedence). City details only open when no unit is selected.

Path assignment lives in `assignUnitPath` (GoTo assignment + animated execution)
and cancellation in `cancelUnitPath`. Do **not** delete the remaining local
`unitPaths` entry after a turn's movement — `TurnManager.processAutomatedMovements`
continues the stored path next turn.

## Right-click semantics (`handleRightClick`)

One right-click does **both**, in this order:

1. **End unit selection** (`selectUnit(null)`, clear reachable tiles and hover
   preview).
2. **Open the ORDERS menu** for the tile, but only when it holds a player unit.

The menu is independent of selection: opening it must **not** re-select the unit
(so the cursor returns to `grab`). Right-clicking a non-unit tile just
deselects; long-press on touch reuses the same handler.

## Turn-number rules

`computeTurnMarkers` in `src/utils/MovementPreview.ts` greedily mirrors
`GameEngine.moveUnit` / `canUnitAffordMove`:

- Per-tile cost comes from `Pathfinding.getMovementCost` (roads `1/3`,
  railroads `~0.05`, ocean impassable to land). **Keep it the single cost source.**
- A **fresh** unit may always make its first move even into terrain costing more
  than it has ("Minimum 1 Move"); that move spends all points.
- When points run out, the next turn starts with `maxMoves`.
- Turn 1 = the first turn in which the unit actually moves (the current one when
  it has moves, otherwise the next one).
- Returns `[]` when the whole path fits in a single turn.

## Renderer contract

`MapRenderer` receives these optional params (threaded from `GameCanvas` through
`renderStaticFrame`/`renderFrame` → `drawDynamicContent`):

- `reachableTiles` / `reachableUnitType` — movement overlay.
- `hoveredHex` — hovered-tile outline.
- `previewPath` — dashed hover path + destination ring (`drawPreviewPath`).
- `previewTurnMarkers` — numbered discs (`drawTurnMarkers`).

Hover/preview drawing honours fog of war (explored tiles only) and sits above
units so the destination and ETA stay readable.

## Tests

- `tests/movementPreview.test.ts` — turn markers (single turn, multi-turn, roads,
  min-1 move, waiting a turn, empty path) and preview path shape.
- `e2e/game.spec.ts` → `Unit Movement mode` — auto-selected unit has the
  `crosshair` cursor; a single right-click while a unit is selected opens the
  ORDERS menu.

When changing movement costs or the min-1 rule, update the engine and
`MovementPreview.ts` together, then re-run the unit tests.
