/**
 * Wonder construction: world-uniqueness, completion, the production-conflict
 * rule and every construction gate.
 *
 * Spec rules exercised here:
 *  - a wonder is produced in a city exactly like any other building;
 *  - several cities (any civs) may work on the SAME wonder simultaneously;
 *  - only the FIRST completion claims it — every other city loses its
 *    invested shields and goes idle, emitting the conflict event that drives
 *    the "already completed" modal;
 *  - completed wonders can no longer be started anywhere;
 *  - wonders cannot be sold, need their technology, and an obsolete wonder
 *    can no longer be started;
 *  - nuclear weapons stay locked until the Manhattan Project exists.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { world as wrapWorld, type TestWorld } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import type { City, Civilization } from '../types/game';

interface EmittedEvent {
  type: string;
  data: Record<string, unknown>;
}

describe('wonder construction & world-uniqueness', () => {
  let engine: GameEngine;
  let w: TestWorld;
  let events: EmittedEvent[];

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    events = [];
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      events.push({ type, data: data ?? {} });
    };
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 500,
      mapSeed: 4242,
    });
    w = wrapWorld(engine);
  });

  afterEach(() => {
    engine.onStateChange = null;
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  const civ = (id: number): Civilization => engine.civilizations[id];

  /** A fresh city with `techs` researched, owned by `civId`. */
  const cityWithTech = (name: string, civId: number, col: number, row: number, techs: string[] = []): City => {
    const city = w.settle(name, col, row, civId, 2);
    for (const t of techs) {
      const list = civ(civId).technologies as string[];
      if (!list.includes(t)) list.push(t);
    }
    return city;
  };

  /** Queue `wonderId` in the city and top up shields so it completes next tick. */
  const queueAndComplete = (city: City, wonderId: string, name: string, cost: number) => {
    const res = engine.productionManager.setCityProduction(city.id, {
      type: 'building', itemType: wonderId, name, cost,
    });
    expect(res.success, `queue ${wonderId}: ${res.reason}`).toBe(true);
    city.productionStored = cost;
  };

  it('the first completion claims the wonder and emits WONDER_COMPLETED', async () => {
    const city = cityWithTech('WonderTown', 0, 4, 4, ['masonry']);
    queueAndComplete(city, 'pyramids', 'Pyramids', 300);

    await w.runTurns(1);

    expect(city.buildings).toContain('pyramids');
    expect(city.wonders).toContain('pyramids');
    expect(engine.wonderManager?.isBuilt('pyramids')).toBe(true);
    expect(engine.wonderManager?.ownerCivId('pyramids')).toBe(0);
    const done = events.find((e) => e.type === 'WONDER_COMPLETED');
    expect(done).toBeDefined();
    expect(done?.data.wonderId).toBe('pyramids');
    expect(done?.data.cityId).toBe(city.id);
    expect(done?.data.civilizationId).toBe(0);
    // The normal building event still fires so AI auto-production keeps feeding.
    expect(events.some((e) => e.type === 'BUILDING_COMPLETED' && e.data.buildingType === 'pyramids')).toBe(true);
  });

  it('a lost race wastes the shields and leaves the city idle (conflict event)', async () => {
    const mine = cityWithTech('FirstMover', 0, 4, 4, ['masonry']);
    const theirs = cityWithTech('SecondMover', 1, 0, 0, ['masonry']);
    // Both cities work on the SAME wonder at the same time — allowed by spec.
    queueAndComplete(mine, 'pyramids', 'Pyramids', 300);
    queueAndComplete(theirs, 'pyramids', 'Pyramids', 300);

    await w.runTurns(1);

    // Exactly one owner — the first city to finish.
    expect(mine.buildings).toContain('pyramids');
    expect(theirs.buildings).not.toContain('pyramids');
    expect(engine.wonderManager?.ownerCivId('pyramids')).toBe(0);

    // The loser is IDLE: production cancelled, progress zeroed, queue kept.
    expect(theirs.currentProduction).toBeNull();
    expect(theirs.productionStored).toBe(0);
    expect(theirs.productionProgress).toBe(0);

    const conflict = events.find((e) => e.type === 'WONDER_PRODUCTION_CONFLICT');
    expect(conflict, 'conflict event emitted').toBeDefined();
    expect(conflict?.data.wonderId).toBe('pyramids');
    expect(conflict?.data.cityId).toBe(theirs.id);
    expect(conflict?.data.ownerCityId).toBe(mine.id);
    expect(conflict?.data.ownerCivId).toBe(0);
    expect(conflict?.data.civilizationId).toBe(1);
    // Only one completion event in the whole world.
    expect(events.filter((e) => e.type === 'WONDER_COMPLETED')).toHaveLength(1);
  });

  it('two cities of the SAME civ racing each other also hit the conflict rule', async () => {
    const a = cityWithTech('CityA', 0, 4, 4, ['masonry']);
    const b = cityWithTech('CityB', 0, 2, 4, ['masonry']);
    queueAndComplete(a, 'pyramids', 'Pyramids', 300);
    queueAndComplete(b, 'pyramids', 'Pyramids', 300);

    await w.runTurns(1);

    expect(a.buildings.filter((x) => x === 'pyramids')).toHaveLength(1);
    expect(b.buildings).not.toContain('pyramids');
    expect(events.filter((e) => e.type === 'WONDER_COMPLETED')).toHaveLength(1);
    expect(events.some((e) => e.type === 'WONDER_PRODUCTION_CONFLICT')).toBe(true);
  });

  it('a completed wonder can no longer be started anywhere', () => {
    const holder = cityWithTech('Holder', 0, 4, 4, ['masonry']);
    holder.buildings.push('pyramids');
    const other = cityWithTech('Other', 1, 0, 0, ['masonry']);

    const res = engine.productionManager.setCityProduction(other.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('wonder_already_completed');
    expect(engine.productionManager.getBuildableBuildingTypes(other.id)).not.toContain('pyramids');
  });

  it('racing — starting a wonder somebody else is merely BUILDING — is allowed', () => {
    const theirs = cityWithTech('TheirCity', 1, 0, 0, ['masonry']);
    // The rival is working on it but has not finished.
    const started = engine.productionManager.setCityProduction(theirs.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(started.success).toBe(true);

    const mine = cityWithTech('MyCity', 0, 4, 4, ['masonry']);
    const alsoStarted = engine.productionManager.setCityProduction(mine.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(alsoStarted.success, 'multiple cities may work on the same wonder').toBe(true);
  });

  it('gates: missing technology, already-owned-here, and obsolescence', () => {
    const city = cityWithTech('GateCity', 0, 4, 4, []); // no techs
    const attempt = (itemType: string, name: string, cost: number) =>
      engine.productionManager.setCityProduction(city.id, { type: 'building', itemType, name, cost });

    // 1. Tech gate
    const noTech = attempt('pyramids', 'Pyramids', 300);
    expect(noTech.success).toBe(false);
    expect(noTech.reason).toBe('requires_tech_masonry');

    // 2. Research it — now allowed
    (civ(0).technologies as string[]).push('masonry');
    expect(attempt('pyramids', 'Pyramids', 300).success).toBe(true);

    // 3. This city already holds it → duplicate
    city.buildings.push('pyramids');
    const dup = attempt('pyramids', 'Pyramids', 300);
    expect(dup.success).toBe(false);
    expect(dup.reason).toBe('already_built');
    city.buildings = city.buildings.filter((b) => b !== 'pyramids');

    // 4. Obsolete (somebody discovered Communism) → can no longer be started
    (civ(1).technologies as string[]).push('communism');
    expect(engine.wonderManager?.isObsolete('pyramids')).toBe(true);
    const obsolete = attempt('pyramids', 'Pyramids', 300);
    expect(obsolete.success).toBe(false);
    expect(obsolete.reason).toBe('wonder_obsolete');
  });

  it('buildable list includes wonders the city could actually start', () => {
    const city = cityWithTech('ListCity', 0, 4, 4, ['map_making', 'bronze_working']);
    const buildable = engine.productionManager.getBuildableBuildingTypes(city.id);
    expect(buildable).toContain('colossus');
    expect(buildable).toContain('lighthouse');
    expect(buildable).toContain('anaximanders_map');
    // Literacy unknown → Great Library not offered.
    expect(buildable).not.toContain('great_library');
    // Wonder techs gate the idle-city detector too.
    expect(engine.productionManager.cityHasBuildableItems(city.id)).toBe(true);
  });

  it('wonders cannot be sold', () => {
    const city = cityWithTech('Holder', 0, 4, 4, ['masonry']);
    city.buildings.push('pyramids');
    const result = engine.sellBuilding(city.id, 'pyramids');
    expect(result.success).toBe(false);
    expect(city.buildings).toContain('pyramids');
  });

  it('nuclear weapons require the Manhattan Project (global gate)', () => {
    const city = cityWithTech('NukeCity', 0, 4, 4, ['nuclear_power']);
    const attempt = () => engine.productionManager.setCityProduction(city.id, {
      type: 'unit', itemType: 'nuclear', name: 'Nuclear', cost: 160,
    });
    const locked = attempt();
    expect(locked.success).toBe(false);
    expect(locked.reason).toBe('requires_wonder_manhattan_project');

    // Anybody completes the project → the gate opens for everyone with the tech.
    const projectSite = cityWithTech('ProjectSite', 1, 0, 0, ['nuclear_fission']);
    projectSite.buildings.push('manhattan_project');
    expect(attempt().success).toBe(true);
  });

  it('a purchased wonder that lost the race refunds the gold', async () => {
    const buyer = cityWithTech('Buyer', 0, 4, 4, ['masonry']);
    const holder = cityWithTech('AlreadyDone', 1, 0, 0, ['masonry']);

    // 1. The purchase is queued while the wonder is still up for grabs.
    const goldBefore = civ(0).resources.gold ?? 0;
    const purchase = engine.productionManager.purchaseCityProduction(buyer.id, {
      type: 'building', itemType: 'pyramids', name: 'Pyramids', cost: 300,
    });
    expect(purchase.success).toBe(true);
    expect(civ(0).resources.gold).toBe(goldBefore - 300);

    // 2. …and while it sits in the purchase queue, another city finishes it.
    holder.buildings.push('pyramids');

    await w.runTurns(1);

    expect(buyer.buildings).not.toContain('pyramids');
    // The turn also pays normal tax income, so compare against the floor:
    // without the refund the treasury would sit ~300 gold BELOW goldBefore.
    expect(civ(0).resources.gold, 'gold refunded on conflict').toBeGreaterThanOrEqual(goldBefore);
    expect(events.some((e) => e.type === 'WONDER_PRODUCTION_CONFLICT')).toBe(true);
  });

  it('wonders survive save/load inside city.buildings (no extra state to sync)', async () => {
    const city = cityWithTech('Saver', 0, 4, 4, ['masonry']);
    city.buildings.push('pyramids');

    const json = engine.getSaveJSON();
    expect(json).toContain('"pyramids"');
    const parsed = JSON.parse(json) as { cities: Array<{ buildings: string[] }> };
    expect(parsed.cities.some((c) => c.buildings.includes('pyramids'))).toBe(true);
    // The wonder registry is derived from cities — nothing else is persisted.
    expect(Object.prototype.hasOwnProperty.call(parsed, 'builtWonders')).toBe(false);
  });
});
