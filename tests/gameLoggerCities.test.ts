/**
 * Verifies that the GameLogger regularly includes the full (JSON-safe) city
 * snapshots: on city-related events via `detail.city`, and on turn boundaries
 * (TURN_START / TURN_END) via `detail.cities` for the active player.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { gameLogger } from '@/utils/GameLogger';

describe('GameLogger full city JSON inclusion', () => {
  beforeEach(() => {
    gameLogger.setSession('test-city-log');
    gameLogger.setContext(() => ({ round: 1, player: 0 }));
  });

  it('includes the full city JSON on city-related events', async () => {
    const city = {
      id: 'city-1',
      name: 'Berlin',
      civilizationId: 0,
      col: 5,
      row: 7,
      population: 2,
      production: 3,
      food: 1,
      gold: 2,
      science: 1,
      currentProduction: 'warrior',
      buildings: ['granary'],
      processTurn: () => {}, // must be stripped for JSON-safety
    };

    gameLogger.record('CITY_FOUNDED', { city, settler: { id: 'u1' } });

    const entries = await gameLogger.getAllEntries();
    const founded = entries.find((e) => e.event === 'CITY_FOUNDED');
    expect(founded).toBeDefined();
    const cityDetail = (founded?.detail as Record<string, unknown>).city as Record<string, unknown>;
    expect(cityDetail).toEqual(
      expect.objectContaining({
        id: 'city-1',
        name: 'Berlin',
        civilizationId: 0,
        col: 5,
        row: 7,
        population: 2,
        currentProduction: 'warrior',
        buildings: ['granary'],
      }),
    );
    expect(JSON.stringify(cityDetail)).not.toContain('processTurn');
  });

  it('includes full city JSONs for the active player on turn boundaries', async () => {
    const cities = [
      {
        id: 'city-1',
        name: 'Berlin',
        civilizationId: 0,
        col: 5,
        row: 7,
        population: 2,
        gold: 10,
        processTurn: () => {},
      },
      {
        id: 'city-2',
        name: 'Hamburg',
        civilizationId: 0,
        col: 8,
        row: 9,
        population: 1,
        gold: 5,
        processTurn: () => {},
      },
    ];

    gameLogger.record('TURN_START', { civilizationId: 0, roundNumber: 1, cities });

    const entries = await gameLogger.getAllEntries();
    const turnStart = entries.find((e) => e.event === 'TURN_START');
    expect(turnStart).toBeDefined();
    const cityList = (turnStart?.detail as Record<string, unknown>).cities as Array<Record<string, unknown>>;
    expect(Array.isArray(cityList)).toBe(true);
    expect(cityList).toHaveLength(2);
    expect(cityList[0]).toEqual(expect.objectContaining({ id: 'city-1', name: 'Berlin' }));
    expect(JSON.stringify(cityList)).not.toContain('processTurn');
  });

  it('keeps the sanitized data field alongside the full city snapshots', async () => {
    gameLogger.record('TURN_END', {
      civilizationId: 0,
      roundNumber: 1,
      cities: [{ id: 'city-1', name: 'Berlin', civilizationId: 0, col: 5, row: 7, population: 2 }],
    });

    const entries = await gameLogger.getAllEntries();
    const turnEnd = entries.find((e) => e.event === 'TURN_END');
    expect(turnEnd).toBeDefined();
    const detail = turnEnd?.detail as Record<string, unknown>;
    // Original payload is still present (sanitized), plus the full city list.
    expect(detail.data).toBeDefined();
    expect(Array.isArray(detail.cities)).toBe(true);
  });
});
