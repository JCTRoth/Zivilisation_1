import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';

/**
 * Civ I — "no city, no people".
 *
 * When a civilization loses its LAST city and it still has at least one unit
 * on the board that is NOT a settler, every one of its remaining units is
 * destroyed and the civilization is finished (GameEngine.applyLastCityRule).
 *
 * The exception is a people left with nothing but settlers: they may walk to
 * open ground and found a new city, so their story is not over.
 *
 * The rule is one choke point (`markCityLost`), so it fires for every way a
 * city can leave a civilization: captured, razed at size 1, scout rush, or a
 * nuclear strike.
 */
describe('Last city lost — civilization eliminated', () => {
  let engine: GameEngine;
  let emitted: Array<{ type: string; data: Record<string, unknown> }>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      emitted.push({ type, data: data ?? {} });
    };
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
    // The human must be human for the toast path: `isAIVsAI` suppresses every
    // notification when no civ is human, and a bare engine has none marked.
    engine.civilizations[0].isHuman = true;
    useGameStore.getState().actions.resetGameState();
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
    useGameStore.getState().actions.resetGameState();
  });

  let cityCounter = 0;

  const isLand = (col: number, row: number): boolean => {
    const tile = (engine as any).getTileAt?.(col, row);
    if (!tile) return false;
    const type = String(tile.type ?? '').toLowerCase();
    return type !== 'ocean' && type !== 'water';
  };

  /** Wipe civ 1 off the board — cities and units — for a clean scenario. */
  const clearCiv = (civId: number): void => {
    (engine as any).cities = engine.cities.filter((c: any) => c.civilizationId !== civId);
    (engine as any).units = engine.units.filter((u: any) => u.civilizationId !== civId);
  };

  const clearCivOne = (): void => clearCiv(1);

  const addCity = (civId: number, population: number): any => {
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    for (let row = 2; row < height - 2; row++) {
      for (let col = 2; col < width - 2; col++) {
        if (!isLand(col, row)) continue;
        if (engine.cities.some((c: any) => c.col === col && c.row === row)) continue;
        const city: any = {
          id: `city_${civId}_${cityCounter++}`,
          name: `City ${cityCounter}`,
          civilizationId: civId,
          col,
          row,
          population,
          foodStored: 0,
          foodNeeded: population * 20,
          yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
          buildings: [],
          wonders: [],
          buildQueue: [],
          currentProduction: null,
          productionStored: 0,
          productionProgress: 0,
        };
        (engine as any).cities.push(city);
        return city;
      }
    }
    throw new Error('No free land tile for a test city');
  };

  /**
   * Place a unit far from every city (via the real factory, so the unit is
   * fully formed: id, movement, rank state). Starting units sit on city tiles,
   * so a blind push would stack a "far" unit onto the very city under test.
   */
  const addUnit = (civId: number, type: string, opts: { near?: any; minDist?: number } = {}): any => {
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    const minDist = opts.minDist ?? 6;
    const distance = (col: number, row: number) => {
      if (opts.near) {
        return Math.max(Math.abs(col - opts.near.col), Math.abs(row - opts.near.row));
      }
      return engine.cities.reduce(
        (acc, c) => Math.min(acc, Math.max(Math.abs(col - c.col), Math.abs(row - c.row))),
        Infinity,
      );
    };
    for (let row = 2; row < height - 2; row++) {
      for (let col = 2; col < width - 2; col++) {
        if (!isLand(col, row)) continue;
        if (distance(col, row) < minDist) continue;
        if (engine.units.some((u: any) => u.col === col && u.row === row)) continue;
        const before = engine.units.length;
        (engine as any).createUnit(civId, type, col, row);
        const created = engine.units[engine.units.length - 1];
        if (engine.units.length > before && created) return created;
      }
    }
    throw new Error(`No free land tile for a ${type}`);
  };

  /** The attacker: a warrior one step from the city, on a confirmed-empty tile. */
  const placeAttackerNextTo = (city: any): any => {
    const attacker = addUnit(0, 'warrior', { near: city, minDist: 1 });
    // Walk it onto an adjacent empty land tile so the city attack is a move.
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const col = city.col + dc;
      const row = city.row + dr;
      if (!isLand(col, row)) continue;
      if (engine.units.some((u: any) => u.col === col && u.row === row && u.id !== attacker.id)) continue;
      attacker.col = col;
      attacker.row = row;
      return attacker;
    }
    throw new Error('No adjacent land tile for the attacker');
  };

  const eliminationEvents = () => emitted.filter((e) => e.type === 'CIVILIZATION_ELIMINATED');

  it('destroys every remaining unit when the last city falls and a non-settler unit is in the field', () => {
    // Route engine events into the UI layer so the toast path is exercised too.
    const router = new EngineEventRouter(engine);
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      emitted.push({ type, data: data ?? {} });
      router.handle(type, data ?? {});
    };
    useGameStore.getState().actions.removeNotification(-1); // touch the queue so it exists

    clearCivOne();
    const city = addCity(1, 2);
    const attacker = placeAttackerNextTo(city);

    // A warrior and a settler of civ 1 are somewhere else on the map.
    const warrior = addUnit(1, 'warrior');
    const settler = addUnit(1, 'settler');

    randomSpy.mockReturnValue(0.05); // the attacker wins the city

    const result = (engine as any).moveUnit(attacker.id, city.col, city.row);

    expect(result.success).toBe(true);
    expect(result.reason).toBe('city_captured');

    // The city changed hands — civ 1 holds nothing.
    expect(engine.cities.some((c: any) => c.civilizationId === 1)).toBe(false);
    // Every unit of civ 1 is gone, settler included.
    expect(engine.units.filter((u: any) => u.civilizationId === 1)).toHaveLength(0);

    const events = eliminationEvents();
    expect(events).toHaveLength(1);
    expect(events[0].data.civilizationId).toBe(1);
    expect(events[0].data.attackerCivId).toBe(0);
    expect(events[0].data.unitsDestroyed).toBe(2);

    // Each dead unit was announced so the UI can animate the loss.
    const defeated = emitted.filter((e) => e.type === 'UNIT_DEFEATED');
    expect(defeated.some((e) => (e.data.unit as any)?.id === warrior.id)).toBe(true);
    expect(defeated.some((e) => (e.data.unit as any)?.id === settler.id)).toBe(true);
    // One store sync, not one per unit.
    expect(emitted.filter((e) => e.type === 'UNIT_REMOVED')).toHaveLength(1);

    // The engine considers the civilization finished.
    expect(engine.civilizations[1].isAlive).toBe(false);

    // The player is told — as the conqueror, since the human took the city.
    const toasts = useGameStore.getState().uiState.notifications;
    expect(toasts.some((n: { type: string; message: string }) =>
      n.type === 'success' && n.message.includes('has been destroyed'))).toBe(true);
  });

  it('tells the player when their own last city falls and their units are destroyed', () => {
    const router = new EngineEventRouter(engine);
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      emitted.push({ type, data: data ?? {} });
      router.handle(type, data ?? {});
    };

    clearCiv(0);
    const city = addCity(0, 2); // the HUMAN loses this city
    const attacker = placeAttackerNextTo(city);
    attacker.civilizationId = 1; // the attacker belongs to the rival

    // The human has a warrior elsewhere — enough to trigger the wipe.
    addUnit(0, 'warrior');

    randomSpy.mockReturnValue(0.05);

    const result = (engine as any).moveUnit(attacker.id, city.col, city.row);

    expect(result.success).toBe(true);
    expect(engine.cities.some((c: any) => c.civilizationId === 0)).toBe(false);
    expect(engine.units.filter((u: any) => u.civilizationId === 0)).toHaveLength(0);

    const toasts = useGameStore.getState().uiState.notifications;
    expect(toasts.some((n: { type: string; message: string }) =>
      n.type === 'error' && n.message.includes('is no more'))).toBe(true);
  });

  it('spares a people that has only settlers left after losing its last city', () => {
    clearCivOne();
    const city = addCity(1, 2);
    const attacker = placeAttackerNextTo(city);

    const settler = addUnit(1, 'settler');

    randomSpy.mockReturnValue(0.05);

    const result = (engine as any).moveUnit(attacker.id, city.col, city.row);

    expect(result.success).toBe(true);
    expect(result.reason).toBe('city_captured');

    // The settler walks on — it can found a new city.
    expect(engine.units.some((u: any) => u.id === settler.id)).toBe(true);
    expect(emissionCount('CIVILIZATION_ELIMINATED')).toBe(0);
    expect(engine.civilizations[1].isAlive).not.toBe(false);
  });

  it('does nothing when the civilization still owns another city', () => {
    clearCivOne();
    const doomed = addCity(1, 2);
    const survivor = addCity(1, 3);
    const attacker = placeAttackerNextTo(doomed);

    const warrior = addUnit(1, 'warrior');

    randomSpy.mockReturnValue(0.05);

    const result = (engine as any).moveUnit(attacker.id, doomed.col, doomed.row);

    expect(result.success).toBe(true);
    expect(result.reason).toBe('city_captured');

    // One city is gone, but the nation lives — and so do its units.
    expect(engine.cities.some((c: any) => c.id === survivor.id)).toBe(true);
    expect(engine.units.some((u: any) => u.id === warrior.id)).toBe(true);
    expect(emissionCount('CIVILIZATION_ELIMINATED')).toBe(0);
  });

  it('also fires when the last city is razed at size 1', () => {
    clearCivOne();
    const city = addCity(1, 1); // size 1 → razed, not captured
    const attacker = placeAttackerNextTo(city);

    addUnit(1, 'warrior');

    randomSpy.mockReturnValue(0.05);

    const result = (engine as any).moveUnit(attacker.id, city.col, city.row);

    expect(result.success).toBe(true);
    // NOTE: moveUnit reports `city_captured` for a raze too — a pre-existing
    // quirk of that return path (resolveCityCombat does return `city_destroyed`,
    // and the CITY_DESTROYED event below is what the UI listens for).
    expect(emitted.some((e) => e.type === 'CITY_DESTROYED')).toBe(true);

    expect(engine.cities.some((c: any) => c.civilizationId === 1)).toBe(false);
    expect(engine.units.filter((u: any) => u.civilizationId === 1)).toHaveLength(0);
    expect(emissionCount('CIVILIZATION_ELIMINATED')).toBe(1);
  });

  function emissionCount(type: string): number {
    return emitted.filter((e) => e.type === type).length;
  }
});
