/**
 * Map size chooser arithmetic — the numbers the setup dialog shows a player
 * before they commit to a world.
 *
 * The presets carry two promises: every chip is inside the bounds the dialog
 * clamps to (a preset that needs clamping is a lie), and each step up is a
 * felt jump in world area rather than a rounding error.
 */
import { describe, expect, it } from 'vitest';
import {
  MAP_DIM_MAX_HEIGHT,
  MAP_DIM_MAX_WIDTH,
  MAP_DIM_MIN_HEIGHT,
  MAP_DIM_MIN_WIDTH,
  MAP_SIZE_PRESETS,
  STANDARD_MAP_HEIGHT,
  STANDARD_MAP_WIDTH,
  clampMapDim,
  clampMapHeight,
  clampMapWidth,
  mapTiles,
  presetForSize,
  sizeFactorLabel,
  tilesPerCiv,
  tilesVsStandard,
} from '@/data/MapSizePresets';

describe('preset ladder', () => {
  it('ships every preset inside the clamp bounds', () => {
    for (const preset of MAP_SIZE_PRESETS) {
      expect(preset.width, preset.id).toBeGreaterThanOrEqual(MAP_DIM_MIN_WIDTH);
      expect(preset.width, preset.id).toBeLessThanOrEqual(MAP_DIM_MAX_WIDTH);
      expect(preset.height, preset.id).toBeGreaterThanOrEqual(MAP_DIM_MIN_HEIGHT);
      expect(preset.height, preset.id).toBeLessThanOrEqual(MAP_DIM_MAX_HEIGHT);
    }
  });

  it('grows strictly in area, with a felt step between neighbours', () => {
    const areas = MAP_SIZE_PRESETS.map((p) => p.width * p.height);
    for (let i = 1; i < areas.length; i += 1) {
      expect(areas[i], `step ${i}`).toBeGreaterThan(areas[i - 1] * 1.5);
    }
  });

  it('keeps a landscape frame and unique ids', () => {
    const ids = new Set(MAP_SIZE_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(MAP_SIZE_PRESETS.length);
    for (const preset of MAP_SIZE_PRESETS) {
      expect(preset.width / preset.height, preset.id).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('anchors the ladder on the engine default world', () => {
    const standard = presetForSize(STANDARD_MAP_WIDTH, STANDARD_MAP_HEIGHT);
    expect(standard?.id).toBe('standard');
    expect(MAP_SIZE_PRESETS).toContain(standard);
  });
});

describe('clamping', () => {
  it('rounds and clamps into range', () => {
    expect(clampMapWidth(80.4)).toBe(80);
    expect(clampMapWidth(1)).toBe(MAP_DIM_MIN_WIDTH);
    expect(clampMapWidth(9999)).toBe(MAP_DIM_MAX_WIDTH);
    expect(clampMapHeight(49.6)).toBe(50);
    expect(clampMapHeight(-3)).toBe(MAP_DIM_MIN_HEIGHT);
    expect(clampMapHeight(9999)).toBe(MAP_DIM_MAX_HEIGHT);
  });

  it('lands on the minimum for values a slider cannot produce', () => {
    expect(clampMapDim(Number.NaN, 20, 260)).toBe(20);
    expect(clampMapDim(Infinity, 12, 180)).toBe(12);
    expect(clampMapDim(-Infinity, 12, 180)).toBe(12);
  });
});

describe('size statistics', () => {
  it('counts tiles of the current world', () => {
    expect(mapTiles(80, 50)).toBe(4000);
    expect(mapTiles(24, 16)).toBe(384);
  });

  it('reports the standard world as exactly 1×', () => {
    expect(tilesVsStandard(80, 50)).toBe(1);
    expect(sizeFactorLabel(80, 50)).toBe('1');
  });

  it('labels ratios with at most one decimal', () => {
    expect(sizeFactorLabel(168, 105)).toBe('4.4');
    expect(sizeFactorLabel(24, 16)).toBe('0.1');
    expect(sizeFactorLabel(240, 150)).toBe('9');
  });

  it('divides the world among the civilizations in play', () => {
    expect(tilesPerCiv(80, 50, 4)).toBe(1000);
    expect(tilesPerCiv(240, 150, 7)).toBe(5143);
    // Defensive: a civ count below 1 must not produce Infinity.
    expect(tilesPerCiv(80, 50, 0)).toBe(4000);
    expect(tilesPerCiv(80, 50, Number.NaN)).toBe(4000);
  });
});

describe('preset lookup', () => {
  it('finds a preset by exact dimensions and rejects custom ones', () => {
    expect(presetForSize(120, 75)?.id).toBe('large');
    expect(presetForSize(80, 51)).toBeNull();
    expect(presetForSize(7, 7)).toBeNull();
  });
});
