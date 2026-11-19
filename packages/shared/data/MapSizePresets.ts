/**
 * World-size presets and the arithmetic behind the setup dialog's map size
 * chooser.
 *
 * Kept outside the component so the numbers are testable without a DOM and
 * so the engine-facing bounds live in exactly one place: the dialog clamps
 * with these constants, and `GameEngine` accepts anything in the same range
 * (it re-clamps wider, so a value that leaves here is always valid there).
 *
 * The PRESETS are named sizes along one diagonal of the size space — each is
 * a step up from the previous one in *area* (tiles), which is what a player
 * feels: roughly ×2.5 the world per step. STANDARD is the engine default
 * (`Constants.MAP_WIDTH × MAP_HEIGHT`, used by NORMAL_SKIRMISH) and doubles
 * as the reference frame in the UI: the dashed ghost on the preview and the
 * "×N standard" stat both point at it.
 */
import type { TranslationKey } from '@/i18n/en';

/** Inclusive bounds the dialog lets a player reach (engine accepts ≥10×8). */
export const MAP_DIM_MIN_WIDTH = 20;
export const MAP_DIM_MAX_WIDTH = 260;
export const MAP_DIM_MIN_HEIGHT = 12;
export const MAP_DIM_MAX_HEIGHT = 180;

/** The engine's default world — what NORMAL_SKIRMISH generates. */
export const STANDARD_MAP_WIDTH = 80;
export const STANDARD_MAP_HEIGHT = 50;

export interface MapSizePreset {
  /** Stable id — used as a React key and a hover-state handle. */
  id: string;
  width: number;
  height: number;
  labelKey: TranslationKey;
}

/**
 * Named sizes, smallest first. Areas: 384 · 1,536 · 4,000 · 9,000 · 17,640
 * · 36,000 — ×4 → ×2.6 → ×2.25 → ×1.96 → ×2.04, so every chip is a clear,
 * felt jump, and the whole ladder spans a 95× range from duel to epic.
 * All entries sit inside the clamp bounds above.
 */
export const MAP_SIZE_PRESETS: readonly MapSizePreset[] = [
  { id: 'tiny', width: 24, height: 16, labelKey: 'setup.sizeTiny' },
  { id: 'small', width: 48, height: 32, labelKey: 'setup.sizeSmall' },
  { id: 'standard', width: 80, height: 50, labelKey: 'setup.sizeStandard' },
  { id: 'large', width: 120, height: 75, labelKey: 'setup.sizeLarge' },
  { id: 'huge', width: 168, height: 105, labelKey: 'setup.sizeHuge' },
  { id: 'gigantic', width: 240, height: 150, labelKey: 'setup.sizeGigantic' },
];

/** Round and clamp to [min, max]; anything non-finite lands on the minimum. */
export function clampMapDim(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampMapWidth(value: number): number {
  return clampMapDim(value, MAP_DIM_MIN_WIDTH, MAP_DIM_MAX_WIDTH);
}

export function clampMapHeight(value: number): number {
  return clampMapDim(value, MAP_DIM_MIN_HEIGHT, MAP_DIM_MAX_HEIGHT);
}

/** Tiles in the world — the quantity every size comparison is built on. */
export function mapTiles(width: number, height: number): number {
  return Math.max(0, Math.round(width) * Math.round(height));
}

/** The preset with exactly these dimensions, or null for a custom size. */
export function presetForSize(width: number, height: number): MapSizePreset | null {
  return MAP_SIZE_PRESETS.find((p) => p.width === width && p.height === height) ?? null;
}

/** Area ratio against the standard world (80×50 = 4,000 tiles → 1). */
export function tilesVsStandard(width: number, height: number): number {
  return mapTiles(width, height) / (STANDARD_MAP_WIDTH * STANDARD_MAP_HEIGHT);
}

/**
 * The ratio as it is shown: one decimal, but "1" instead of "1.0" — the
 * standard world should read as the default, not as a float.
 */
export function sizeFactorLabel(width: number, height: number): string {
  return String(Number(tilesVsStandard(width, height).toFixed(1)));
}

/**
 * Tiles each civilization gets to itself — the honest number behind "is this
 * world crowded?". A civ count below 1 (defensive against odd inputs) divides
 * by 1 rather than producing Infinity.
 */
export function tilesPerCiv(width: number, height: number, civCount: number): number {
  const civs = Number.isFinite(civCount) ? Math.max(1, Math.round(civCount)) : 1;
  return Math.round(mapTiles(width, height) / civs);
}
