import { describe, expect, it } from 'vitest';
import { computeDevPlayerVision } from '@/utils/DevPlayerVision';

/**
 * The dev panel's "Forge of War as seen by" selector filters the overlay
 * through one player's fog. This helper is the fog: it must match what the
 * normal UI would reveal — own units, own cities and locked teammates — and
 * nothing else. Enemy knowledge must never leak in, or the selector would lie.
 */
const unit = (overrides: Record<string, unknown> = {}) => ({
  id: 'u',
  civilizationId: 0,
  col: 5,
  row: 5,
  type: 'warrior',
  ...overrides,
});

const city = (overrides: Record<string, unknown> = {}) => ({
  id: 'c',
  civilizationId: 0,
  col: 10,
  row: 10,
  ...overrides,
});

const visionFor = (
  playerId: number,
  units: Array<Record<string, unknown>>,
  cities: Array<Record<string, unknown>> = [],
  civilizations: Array<Record<string, unknown>> = [],
) =>
  computeDevPlayerVision({
    playerId,
    units: units as never[],
    cities: cities as never[],
    civilizations: civilizations as never[],
    width: 20,
    height: 20,
  });

describe('Dev overlay — player vision for the Forge of War selector', () => {
  it('reveals a square around every own unit, with the global 2-tile floor', () => {
    const vision = visionFor(0, [unit()]);

    expect(vision.isVisible(5, 5)).toBe(true);
    expect(vision.isVisible(3, 3)).toBe(true); // corner of the 5×5 square
    expect(vision.isVisible(2, 5)).toBe(false);
    expect(vision.isVisible(8, 8)).toBe(false);
  });

  it('uses the unit type sight range when it is above the floor', () => {
    const vision = visionFor(0, [unit({ type: 'battleship' })]);

    // UNIT_DATA_MAP gives battleships sight 3.
    expect(vision.isVisible(2, 5)).toBe(true);
    expect(vision.isVisible(1, 5)).toBe(false);
  });

  it('reveals a 2-tile square around every own city', () => {
    const vision = visionFor(0, [], [city()]);

    expect(vision.isVisible(8, 8)).toBe(true);
    expect(vision.isVisible(7, 10)).toBe(false);
  });

  it('shares vision with locked teammates but not with other civs', () => {
    const civilizations = [
      { id: 0, teamId: 7 },
      { id: 1, teamId: 7 },
      { id: 2, teamId: 9 },
    ];
    const vision = visionFor(
      0,
      [unit({ civilizationId: 1, col: 15, row: 15 }), unit({ civilizationId: 2, col: 2, row: 2 })],
      [],
      civilizations,
    );

    expect(vision.isVisible(15, 15)).toBe(true); // teammate
    expect(vision.isVisible(2, 2)).toBe(false); // stranger
  });

  it('ignores enemy units and enemy cities', () => {
    const vision = visionFor(
      0,
      [unit({ civilizationId: 1, col: 15, row: 15 })],
      [city({ civilizationId: 1, col: 2, row: 2 })],
    );

    expect(vision.isVisible(15, 15)).toBe(false);
    expect(vision.isVisible(2, 2)).toBe(false);
  });

  it('skips defeated units', () => {
    const vision = visionFor(0, [unit({ isDefeated: true })]);

    expect(vision.isVisible(5, 5)).toBe(false);
  });

  it('clips the sight squares at the map edge', () => {
    const vision = visionFor(0, [unit({ col: 0, row: 0 })]);

    expect(vision.isVisible(0, 0)).toBe(true);
    expect(vision.isVisible(2, 2)).toBe(true);
    expect(vision.isVisible(3, 0)).toBe(false);
    // isVisible guards the bounds itself.
    expect(vision.isVisible(-1, 0)).toBe(false);
    expect(vision.isVisible(0, 20)).toBe(false);
  });
});
