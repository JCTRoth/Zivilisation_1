import { HUMAN_PLAYER_ID } from '../../utils/PlayerConstants';
import type { Unit } from '../../types/game';
import type { GameRuntime } from '../../ports/runtime';

/**
 * Fog-of-war "new sighting" detection.
 *
 * A unit following a GoTo path must stop when a step reveals an enemy the
 * player had not seen before — the path was plotted through unexplored terrain
 * and the player now has a decision to make (attack, retreat, re-route).
 *
 * Only *newly* visible enemies count: an enemy that was already on screen
 * (e.g. the path is running past a known enemy) must not cancel the order.
 *
 * Visibility comes from the injected runtime port: the browser reads the
 * Zustand projection, the server/headless runtime reports nothing (so no GoTo
 * path is ever interrupted on a headless simulation).
 */

/** Ids of every enemy unit currently standing on a tile the human can see. */
export function getVisibleEnemyUnitIds(runtime: GameRuntime): Set<string> {
  const { units, width, visibility, devMode } = runtime.visibility();
  const visible = new Set<string>();

  if (!units.length) return visible;
  if (!width && !devMode) return visible;

  for (const unit of units) {
    if (unit.civilizationId === HUMAN_PLAYER_ID) continue;
    if (unit.isDefeated) continue;
    const index = unit.row * width + unit.col;
    if (devMode || (width > 0 && visibility[index])) {
      visible.add(unit.id);
    }
  }
  return visible;
}

/** Enemy units visible now that were not visible in `previous`. */
export function findNewlySightedEnemies(previous: Set<string>, runtime: GameRuntime): Unit[] {
  const { units } = runtime.visibility();
  const newly: Unit[] = [];
  for (const id of getVisibleEnemyUnitIds(runtime)) {
    if (previous.has(id)) continue;
    const unit = units.find((u) => u.id === id);
    if (unit) newly.push(unit);
  }
  return newly;
}
