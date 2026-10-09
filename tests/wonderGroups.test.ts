/**
 * Wonder groups — mutually exclusive wonders (the space stations).
 *
 * - Data: members share cost, tech, obsolescence and effects; groupId points
 *   at a declared WONDER_GROUPS entry.
 * - Gates: once any member is completed anywhere, the sisters can no longer
 *   be started (`wonder_group_completed`).
 * - Races: cities may race different members of an open group; the first
 *   completion wins and the losers hit the production-conflict path, which
 *   names the wonder that actually won (`blockedByWonderId`).
 * - Statuses: closed sisters take the completed member's colour (green when
 *   yours, red when a rival's).
 * - AI: a built member retires its sisters from planning.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { world as wrapWorld, type TestWorld } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import { AIBuildingStrategy } from '@/game/engine/AI/AIBuildingStrategy';
import {
  WONDER_GROUPS,
  computeWonderStatuses,
  wonderGroupId,
  wonderGroupMembers,
} from '@/data/WonderData';
import type { City, Civilization } from '../types/game';

describe('wonder group data', () => {
  it('declares the space-station group with ISS, Tiangong and Mir', () => {
    expect(WONDER_GROUPS.space_station.name).toBe('Space Stations');
    expect(wonderGroupId('international_space_station')).toBe('space_station');
    expect(wonderGroupId('tiangong')).toBe('space_station');
    expect(wonderGroupId('mir')).toBe('space_station');
    expect(wonderGroupMembers('mir').sort()).toEqual(
      ['international_space_station', 'tiangong', 'mir'].sort(),
    );
    expect(wonderGroupId('pyramids')).toBeNull();
    expect(wonderGroupMembers('pyramids')).toEqual([]);
    expect(wonderGroupId('not_a_wonder')).toBeNull();
  });
});

describe('wonder group exclusivity (live engine)', () => {
  let engine: GameEngine;
  let w: TestWorld;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    engine.onStateChange = null;
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

  /** Read-only construction gate (canBuildItem is private on the manager). */
  const canBuild = (
    cityId: string,
    itemType: string,
  ): { ok: boolean; reason?: string } =>
    (
      engine.productionManager as unknown as {
        canBuildItem: (cityId: string, itemType: string) => { ok: boolean; reason?: string };
      }
    ).canBuildItem(cityId, itemType);

  const cityWithTech = (name: string, civId: number, col: number, row: number, techs: string[] = []): City => {
    const city = w.settle(name, col, row, civId, 2);
    for (const t of techs) {
      const list = civ(civId).technologies as string[];
      if (!list.includes(t)) list.push(t);
    }
    return city;
  };

  const queueAndComplete = (city: City, wonderId: string, name: string, cost: number) => {
    const res = engine.productionManager.setCityProduction(city.id, {
      type: 'building', itemType: wonderId, name, cost,
    });
    expect(res.success, `queue ${wonderId}: ${res.reason}`).toBe(true);
    city.productionStored = cost;
  };

  it('an open group lets sisters be queued; a closed one refuses them', async () => {
    const a = cityWithTech('StationA', 0, 4, 4, ['space_flight']);
    const b = cityWithTech('StationB', 1, 0, 0, ['space_flight']);

    // Nobody built anything yet: sisters are startable.
    expect(engine.wonderManager?.isGroupCompleted('space_station')).toBe(false);
    expect(engine.wonderManager?.isGroupClosed('tiangong')).toBe(false);
    expect(canBuild(a.id, 'tiangong').ok).toBe(true);

    // Civ 0 completes the ISS.
    queueAndComplete(a, 'international_space_station', 'International Space Station', 600);
    await w.runTurns(1);
    expect(engine.wonderManager?.isBuilt('international_space_station')).toBe(true);
    expect(engine.wonderManager?.isGroupCompleted('space_station')).toBe(true);
    expect(engine.wonderManager?.isGroupClosed('tiangong')).toBe(true);
    expect(engine.wonderManager?.isGroupClosed('mir')).toBe(true);
    expect(
      engine.wonderManager?.findGroupCity('tiangong')?.id,
    ).toBe(a.id);

    // The sisters are now refused with the group reason.
    const attempt = engine.productionManager.setCityProduction(b.id, {
      type: 'building', itemType: 'tiangong', name: 'Tiangong', cost: 600,
    });
    expect(attempt.success).toBe(false);
    expect(attempt.reason).toBe('wonder_group_completed');
    expect(canBuild(b.id, 'mir').ok).toBe(false);
    expect(canBuild(b.id, 'mir').reason).toBe('wonder_group_completed');

    // ...and they vanish from the buildable list.
    const buildable = engine.productionManager.getBuildableBuildingTypes(b.id);
    expect(buildable).not.toContain('tiangong');
    expect(buildable).not.toContain('mir');
    expect(buildable).not.toContain('international_space_station');
  });

  it('a cross-member race ends in a conflict that names the winner', async () => {
    const mine = cityWithTech('FirstMover', 0, 4, 4, ['space_flight']);
    const theirs = cityWithTech('SecondMover', 1, 0, 0, ['space_flight']);
    // Different members of the same open group may race, like same-wonder races.
    queueAndComplete(mine, 'international_space_station', 'International Space Station', 600);
    queueAndComplete(theirs, 'tiangong', 'Tiangong', 600);

    const seen: Array<{ type: string; data: Record<string, unknown> }> = [];
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      seen.push({ type, data: data ?? {} });
    };
    await w.runTurns(1);
    engine.onStateChange = null;

    // First completion wins; the sister is never built.
    expect(engine.wonderManager?.ownerCivId('international_space_station')).toBe(0);
    expect(theirs.buildings).not.toContain('tiangong');
    expect(engine.wonderManager?.isBuilt('tiangong')).toBe(false);

    // The loser goes idle through the standard conflict path...
    expect(theirs.currentProduction).toBeNull();
    expect(theirs.productionStored).toBe(0);
    // ...whose event names the wonder that actually won.
    const conflict = seen.find((e) => e.type === 'WONDER_PRODUCTION_CONFLICT');
    expect(conflict, 'conflict event emitted').toBeDefined();
    expect(conflict?.data.wonderId).toBe('tiangong');
    expect(conflict?.data.blockedByWonderId).toBe('international_space_station');
    expect(conflict?.data.ownerCivId).toBe(0);
  });

  it('closed sisters take the completed member\u2019s status colour', () => {
    const city = (id: string, civId: number, extra: Record<string, unknown> = {}) => ({
      id,
      civilizationId: civId,
      buildings: [],
      currentProduction: null,
      buildQueue: [],
      ...extra,
    });
    const techs = [
      { id: 0, technologies: ['space_flight'] },
      { id: 1, technologies: ['space_flight'] },
    ];

    // Player owns the ISS: the sisters read green.
    let statuses = computeWonderStatuses(
      [city('a', 0, { buildings: ['international_space_station'] })],
      techs,
      0,
    );
    expect(statuses.international_space_station).toBe('owned');
    expect(statuses.tiangong).toBe('owned');
    expect(statuses.mir).toBe('owned');

    // A rival owns it: the sisters read red.
    statuses = computeWonderStatuses(
      [city('a', 1, { buildings: ['mir'] })],
      techs,
      0,
    );
    expect(statuses.mir).toBe('rival');
    expect(statuses.international_space_station).toBe('rival');
    expect(statuses.tiangong).toBe('rival');
  });
});

describe('wonder group AI planning', () => {
  it('a built group member retires its sisters from AI plans', () => {
    const city = {
      id: 'city-1', name: 'TestCity', civilizationId: 1, col: 5, row: 5,
      population: 4, production: 0, food: 0, gold: 0, science: 0, buildings: [],
    };
    const civ = {
      id: 1, name: 'TestCiv', technologies: ['space_flight'],
    };
    const gameState = {
      currentYear: -2000, isUnderThreat: false, builtWonders: ['international_space_station'] as string[],
    };
    const plans = AIBuildingStrategy.evaluateWonders(
      city as never, civ as never, 'balanced_growth', gameState as never,
    );
    expect(plans.find((p) => p.buildingType === 'international_space_station')).toBeUndefined();
    expect(plans.find((p) => p.buildingType === 'tiangong')).toBeUndefined();
    expect(plans.find((p) => p.buildingType === 'mir')).toBeUndefined();
  });
});
