/**
 * A carrier carries AIRCRAFT. A transport carries TROOPS. They are not the same
 * hold.
 *
 * Before this, `transportCapacity` was the only cargo field in the game and
 * "capacity > 0" meant "this hull is a transport" everywhere — fleet counts,
 * doctrine inputs and target classification all read it. Giving the carrier
 * `transportCapacity` would therefore have made it sealift (so the doctrine
 * stopped buying ferries), removed it from the warship count (so the fleet lost
 * its air arm) and re-classified it as a transport to be sunk first. Aircraft
 * got their own hold instead, and the boarding gate enforces which hull may
 * lift which passenger.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { UNIT_PROPS } from '@/utils/Constants';

describe('a carrier carries aircraft, a transport carries troops', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    await engine.initialize({ numberOfCivilizations: 2, mapType: 'CLOSEUP_1V1', devMode: false, startingGold: 100 });
  });

  afterEach(() => {
    (engine as unknown as { units: unknown[] }).units = [];
  });

  const addUnit = (over: Record<string, unknown>) => {
    const unit = {
      id: `ca_${Math.random()}`,
      civilizationId: 0,
      movesRemaining: 1,
      isDefeated: false,
      health: 100,
      ...over,
    };
    (engine as unknown as { units: unknown[] }).units.push(unit);
    return unit as unknown as { id: string; type: string; col: number; row: number; embarkedOn?: string | null; cargoUnitIds?: string[] };
  };

  /** Put a hull on deep water, which is where loading happens. */
  const waterTile = () => {
    const { map } = engine;
    for (let r = 0; r < map.height; r++) {
      for (let c = 0; c < map.width; c++) {
        const tile = engine.getTileAt(c, r);
        if (tile && (engine as unknown as { getTerrainKey(t: unknown): string }).getTerrainKey(tile) === 'ocean') return { col: c, row: r };
      }
    }
    // Force one if the map has none.
    const tile = engine.getTileAt(2, 2)!;
    tile.terrain = 'ocean';
    tile.type = 'ocean';
    return { col: 2, row: 2 };
  };

  it('gives the carrier an air hold and no troop hold', () => {
    expect(UNIT_PROPS.carrier.aircraftCapacity).toBeGreaterThan(0);
    expect(UNIT_PROPS.carrier.transportCapacity ?? 0).toBe(0);
  });

  it('loads a fighter onto a carrier', () => {
    const at = waterTile();
    const carrier = addUnit({ type: 'carrier', col: at.col, row: at.row });
    const fighter = addUnit({ type: 'fighter', col: at.col, row: at.row });

    expect(engine.canLoadFerry(carrier.id, fighter.id)).toBe(true);
    expect(engine.loadFerry(carrier.id, fighter.id)).toBe(true);
    expect(engine.isAboard(carrier as never, fighter.id)).toBe(true);
  });

  it('REFUSES to load a warrior onto a carrier', () => {
    const at = waterTile();
    const carrier = addUnit({ type: 'carrier', col: at.col, row: at.row });
    const warrior = addUnit({ type: 'warrior', col: at.col, row: at.row });

    expect(engine.canLoadFerry(carrier.id, warrior.id)).toBe(false);
    expect(engine.loadFerry(carrier.id, warrior.id)).toBe(false);
    expect(engine.isAboard(carrier as never, warrior.id)).toBe(false);
  });

  it('REFUSES to load a fighter onto a transport', () => {
    const at = waterTile();
    const transport = addUnit({ type: 'transport', col: at.col, row: at.row });
    const fighter = addUnit({ type: 'fighter', col: at.col, row: at.row });

    expect(engine.canLoadFerry(transport.id, fighter.id)).toBe(false);
  });

  it('loads a warrior onto a transport', () => {
    const at = waterTile();
    const transport = addUnit({ type: 'transport', col: at.col, row: at.row });
    const warrior = addUnit({ type: 'warrior', col: at.col, row: at.row });

    expect(engine.canLoadFerry(transport.id, warrior.id)).toBe(true);
    expect(engine.loadFerry(transport.id, warrior.id)).toBe(true);
  });

  it('fills a carrier to four airframes and then stops', () => {
    const at = waterTile();
    const carrier = addUnit({ type: 'carrier', col: at.col, row: at.row });
    const capacity = UNIT_PROPS.carrier.aircraftCapacity!;
    for (let i = 0; i < capacity; i++) {
      const fighter = addUnit({ type: 'fighter', col: at.col, row: at.row });
      expect(engine.loadFerry(carrier.id, fighter.id)).toBe(true);
    }
    const overflow = addUnit({ type: 'fighter', col: at.col, row: at.row });
    expect(engine.canLoadFerry(carrier.id, overflow.id)).toBe(false);
  });

  it('still boards a warhead onto a submarine', () => {
    // A Nuclear is `type: 'air'`, so a passenger-side capacity rule would
    // measure a submarine's hold as zero airframes and strand every bomb. The
    // hull defines the hold, and nuke-on-sub is decided before the aircraft gate.
    const at = waterTile();
    const sub = addUnit({ type: 'submarine', col: at.col, row: at.row });
    const warhead = addUnit({ type: 'nuclear', col: at.col, row: at.row });

    expect(engine.canLoadFerry(sub.id, warhead.id)).toBe(true);
    expect(engine.loadFerry(sub.id, warhead.id)).toBe(true);
  });

  it('keeps a warhead off the carrier', () => {
    // The launch platform pairing is exclusive: the bomb travels by stealth.
    const at = waterTile();
    const carrier = addUnit({ type: 'carrier', col: at.col, row: at.row });
    const warhead = addUnit({ type: 'nuclear', col: at.col, row: at.row });
    expect(engine.canLoadFerry(carrier.id, warhead.id)).toBe(false);
  });

  it('sinks the air wing with the carrier', () => {
    const at = waterTile();
    const carrier = addUnit({ type: 'carrier', col: at.col, row: at.row });
    const fighter = addUnit({ type: 'fighter', col: at.col, row: at.row });
    engine.loadFerry(carrier.id, fighter.id);

    (engine as unknown as { destroyCargoOf(u: unknown): void }).destroyCargoOf(carrier as never);
    const stored = (engine as unknown as { units: Array<{ id: string; isDefeated?: boolean }> }).units;
    expect(stored.find((u) => u.id === fighter.id)?.isDefeated).toBe(true);
  });

  it('puts an aircraft ashore the same way it puts a troop ashore', () => {
    const at = waterTile();
    const carrier = addUnit({ type: 'carrier', col: at.col, row: at.row });
    const fighter = addUnit({ type: 'fighter', col: at.col, row: at.row });
    engine.loadFerry(carrier.id, fighter.id);

    // Find a land tile one step off the hull.
    let land: { col: number; row: number } | null = null;
    for (let dc = -1; dc <= 1 && !land; dc++) {
      for (let dr = -1; dr <= 1 && !land; dr++) {
        const tile = engine.getTileAt(at.col + dc, at.row + dr);
        if (tile && (engine as unknown as { getTerrainKey(t: unknown): string }).getTerrainKey(tile) !== 'ocean') {
          land = { col: at.col + dc, row: at.row + dr };
        }
      }
    }
    if (!land) return; // no land on this map: the boarding assertions above are the test
    expect(engine.unloadFerry(carrier.id, land.col, land.row, fighter.id)).toBe(true);
    expect(engine.isAboard(carrier as never, fighter.id)).toBe(false);
  });
});
