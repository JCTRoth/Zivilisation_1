/**
 * Development-mode "whose eyes?" helper.
 *
 * In AI-vs-AI, the dev panel can pin both the map and Forge of War to one
 * civilization's view. Prefer the engine's exact current/explored arrays;
 * the fallback below mirrors normal sight from units, cities and locked
 * teammates when per-player storage is unavailable. This is read-only and does
 * not change AI decision-making.
 */
import { UNIT_TYPES } from '@/data/GameData';
import type { City, Civilization, Unit } from '../../types/game';

/** Visibility snapshot of one player at one moment. */
export interface DevPlayerVision {
  width: number;
  height: number;
  /** Row-major flags: `visible[row * width + col]`. */
  visible: Uint8Array;
  /** Row-major flags for the player's explored map, including old sightings. */
  explored: Uint8Array;
  isVisible: (col: number, row: number) => boolean;
  isExplored: (col: number, row: number) => boolean;
}

export interface DevPlayerVisionInput {
  /** Civilization whose eyes we look through. */
  playerId: number;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
  width: number;
  height: number;
  /** Exact fog arrays from the engine's per-player storage, when available. */
  visibility?: ArrayLike<boolean>;
  explored?: ArrayLike<boolean>;
}

/**
 * The same per-unit sight the store resolves: an explicit `unit.sightRange`
 * wins, otherwise the unit type's value from `UNIT_DATA_MAP` (via `UNIT_TYPES`),
 * with the global floor of 2 tiles that keeps the map from being a peephole.
 */
function unitSightRange(unit: Unit): number {
  const typeId = unit.type ? String(unit.type).toLowerCase() : null;

  let typeDef: { sightRange?: number } | null = null;
  if (typeId) {
    typeDef =
      (Object.values(UNIT_TYPES).find(
        (def) => def && String(def.id).toLowerCase() === typeId,
      ) as { sightRange?: number } | undefined) ?? null;
    // Same singular fallback the store uses ('warriors' → 'warrior').
    if (!typeDef && typeId.endsWith('s')) {
      const singular = typeId.slice(0, -1);
      typeDef =
        (Object.values(UNIT_TYPES).find(
          (def) => def && String(def.id).toLowerCase() === singular,
        ) as { sightRange?: number } | undefined) ?? null;
    }
  }

  const raw =
    typeof unit.sightRange === 'number' ? unit.sightRange : (typeDef?.sightRange ?? 2);
  return Math.max(2, raw);
}

/** Stamp a Chebyshev-radius square into the flag array (clipped to the map). */
function revealSquare(
  visible: Uint8Array,
  width: number,
  height: number,
  centerCol: number,
  centerRow: number,
  radius: number,
): void {
  const minCol = Math.max(0, centerCol - radius);
  const maxCol = Math.min(width - 1, centerCol + radius);
  const minRow = Math.max(0, centerRow - radius);
  const maxRow = Math.min(height - 1, centerRow + radius);
  for (let row = minRow; row <= maxRow; row++) {
    const rowOffset = row * width;
    for (let col = minCol; col <= maxCol; col++) {
      visible[rowOffset + col] = 1;
    }
  }
}

/**
 * Compute what `playerId` currently sees. Units and cities outside the given
 * map bounds are ignored; a player with no units sees nothing (instead of
 * falling back to the omniscient dev view).
 */
export function computeDevPlayerVision(input: DevPlayerVisionInput): DevPlayerVision {
  const { playerId, units, cities, civilizations, width, height } = input;
  const size = Math.max(0, width * height);
  const visible = new Uint8Array(size);
  const explored = new Uint8Array(size);

  // AI-vs-AI has an exact visibility history per civilization in the engine.
  // Prefer it so the dev map matches ordinary play, including territory that
  // was explored earlier and has since gone dark. Engine fog arrays can be
  // larger than a scenario map; their prefix is still row-major using the
  // active map width (the engine's fog index uses that stride).
  const storedVisibilityLength = Math.min(size, input.visibility?.length ?? 0);
  for (let index = 0; index < storedVisibilityLength; index++) {
    visible[index] = input.visibility![index] ? 1 : 0;
  }
  const storedExploredLength = Math.min(size, input.explored?.length ?? 0);
  for (let index = 0; index < storedExploredLength; index++) {
    explored[index] = input.explored![index] ? 1 : 0;
  }

  // Locked alliances share vision — identical to the store's viewer logic.
  const friendly = new Set<number>([playerId]);
  const viewer = civilizations.find((civ) => civ.id === playerId);
  if (viewer?.teamId !== undefined && viewer?.teamId !== null) {
    for (const civ of civilizations) {
      if (civ.teamId === viewer.teamId) friendly.add(civ.id);
    }
  }

  const hasCompleteStoredVisibility = storedVisibilityLength === size;
  if (!hasCompleteStoredVisibility && width > 0 && height > 0) {
    for (const unit of units) {
      if (!friendly.has(unit.civilizationId) || unit.isDefeated) continue;
      revealSquare(visible, width, height, unit.col, unit.row, unitSightRange(unit));
    }
    for (const city of cities) {
      if (!friendly.has(city.civilizationId)) continue;
      revealSquare(visible, width, height, city.col, city.row, 2);
    }
  }
  for (let index = 0; index < size; index++) {
    if (visible[index]) explored[index] = 1;
  }

  return {
    width,
    height,
    visible,
    explored,
    isVisible: (col: number, row: number) =>
      col >= 0 &&
      row >= 0 &&
      col < width &&
      row < height &&
      visible[row * width + col] === 1,
    isExplored: (col: number, row: number) =>
      col >= 0 &&
      row >= 0 &&
      col < width &&
      row < height &&
      explored[row * width + col] === 1,
  };
}
