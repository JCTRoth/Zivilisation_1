/**
 * SAVE FORMAT CONTRACT — one version gate for the whole project.
 *
 * The engine (`GameEngine.loadGame`) and the UI (the file picker in
 * `App.tsx`) both have to answer "can this save be loaded?". When they
 * answer separately they drift: the picker used to accept versions 1–3 while
 * the engine wrote version 5, so a save written by the game could not be
 * loaded back through the menu.
 *
 * This module is the single source of truth. Both sides call
 * `isSupportedSaveVersion()` and read the metadata with `readSaveMetadata()`.
 */

/** The version this build writes. */
export const CURRENT_SAVE_VERSION = 5;

/** The oldest version this build can still migrate. */
export const MIN_SUPPORTED_SAVE_VERSION = 1;

/** The newest version this build can load. Bumped only with a migration. */
export const MAX_SUPPORTED_SAVE_VERSION = 5;

/** Every version this build accepts, oldest first. */
export const SUPPORTED_SAVE_VERSIONS: readonly number[] = Object.freeze(
  Array.from(
    { length: MAX_SUPPORTED_SAVE_VERSION - MIN_SUPPORTED_SAVE_VERSION + 1 },
    (_, i) => MIN_SUPPORTED_SAVE_VERSION + i,
  ),
);

/**
 * True when a save blob's `version` field is one this build can load.
 *
 * Rejects non-numbers, `NaN`, fractional values, strings and out-of-range
 * numbers — a save file is untrusted input (it comes off the player's disk),
 * so the check is deliberately strict.
 */
export function isSupportedSaveVersion(version: unknown): boolean {
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= MIN_SUPPORTED_SAVE_VERSION &&
    version <= MAX_SUPPORTED_SAVE_VERSION
  );
}

/** Human-readable summary of what the file picker should tell the player. */
export function describeSaveVersionSupport(): string {
  return `save versions ${MIN_SUPPORTED_SAVE_VERSION}–${MAX_SUPPORTED_SAVE_VERSION}`;
}

/** The shape of a save blob this module cares about. Everything else is opaque. */
export interface SaveBlobShape {
  version?: unknown;
  timestamp?: unknown;
  currentTurn?: unknown;
  currentYear?: unknown;
  humanCivId?: unknown;
  gameSettings?: { humanPlayerIds?: unknown; [key: string]: unknown } | null;
  civilizations?: Array<{ id?: unknown; name?: unknown; isHuman?: unknown }> | null;
  [key: string]: unknown;
}

/** Metadata shown in the campaign list without loading the whole blob. */
export interface SaveMetadata {
  version: number;
  turn: number;
  year: number;
  civilizationName: string | null;
  /** Epoch millis of the save's own timestamp, or null when absent. */
  timestamp: number | null;
}

/**
 * Read the metadata out of a save blob without trusting the rest of it.
 *
 * Returns null when the JSON is malformed or the version is unsupported — the
 * caller then reports "invalid save file" instead of half-loading a game.
 */
export function readSaveMetadata(json: string): SaveMetadata | null {
  let data: SaveBlobShape;
  try {
    data = JSON.parse(json) as SaveBlobShape;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!isSupportedSaveVersion(data.version)) return null;

  const civilizations = Array.isArray(data.civilizations) ? data.civilizations : [];
  const humanId =
    typeof data.humanCivId === 'number'
      ? data.humanCivId
      : Array.isArray(data.gameSettings?.humanPlayerIds)
        ? (data.gameSettings.humanPlayerIds[0] as number | undefined)
        : undefined;
  const civ =
    civilizations.find((entry) => entry && entry.id === humanId) ??
    civilizations.find((entry) => entry && entry.isHuman) ??
    civilizations[0];

  return {
    version: data.version as number,
    turn: typeof data.currentTurn === 'number' && Number.isFinite(data.currentTurn) ? data.currentTurn : 1,
    year: typeof data.currentYear === 'number' && Number.isFinite(data.currentYear) ? data.currentYear : -4000,
    civilizationName: civ && typeof civ.name === 'string' ? civ.name : null,
    timestamp: typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? data.timestamp : null,
  };
}
