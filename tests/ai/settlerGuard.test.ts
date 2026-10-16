/**
 * Settler guards (land escort): walkers under threat get a bodyguard.
 *
 * Two pinned scenarios on a seeded AI-vs-AI world (barbarians never act in
 * `runTurns`, so the threat is deterministic):
 *
 *  - with a free warrior nearby, an exposed settler is paired with it and
 *    the warrior walks the settler instead of chasing;
 *  - with no guard available, the exposed settler holds instead of walking
 *    into the raider.
 *
 * The settlement search is stubbed to a far site so the mission — and
 * therefore the exposure — survives every turn.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { makeEngine, useSeededRandom } from '../helpers/world';
import type { Unit } from '@/../types/game';

const SEED = 4242;

async function stageScenario(withGuard: boolean) {
  useSeededRandom(SEED);
  const world = await makeEngine({
    seed: SEED,
    mapType: 'AI_VS_AI',
    numberOfCivilizations: 2,
    startingGold: 100,
  });
  const { engine } = world;
  // A clean stage: only the units this scenario places.
  engine.units = engine.units.filter((u) => u.civilizationId !== 0);

  const settler = world.spawnUnit({
    id: 'test-settler',
    type: 'settler',
    civilizationId: 0,
    ...world.landNear(20, 20, 6),
  });
  const farSite = {
    col: Math.min(settler.col + 10, 39),
    row: settler.row,
    score: 99,
  };
  settler._aiSettlement = { ...farSite };
  // The mission must survive the turn: the movement loop re-searches every
  // turn, so pin the search to the same far site — and forbid founding, or
  // the walker founds in place on turn 1 and there is no walk to guard.
  vi.spyOn(engine.aiManager as any, 'findBestSettlementForSettler').mockReturnValue({ ...farSite });
  vi.spyOn(engine.aiManager as any, 'canFoundCityHere').mockReturnValue(false);

  const barbarianPos = world.landNear(settler.col, settler.row, 2);
  const barbarian = world.spawnUnit({
    id: 'test-raider',
    type: 'warrior',
    civilizationId: BARBARIAN_CIV_ID,
    attack: 2,
    defense: 2,
    ...barbarianPos,
  });

  let warrior: Unit | null = null;
  if (withGuard) {
    warrior = world.spawnUnit({
      id: 'test-guard',
      type: 'warrior',
      civilizationId: 0,
      attack: 1,
      defense: 1,
      ...world.landNear(settler.col, settler.row, 3),
    });
  }
  return { world, engine, settler, barbarian, warrior, farSite };
}

describe('settler guards (test game)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pairs an exposed settler with a nearby warrior, and the guard follows', async () => {
    const { world, engine, settler, warrior } = await stageScenario(true);
    // Two rounds: the test harness drives several AI passes per round, so
    // the pair walks deep — assert the escort tableau, not a long march.
    await world.runTurns(2);

    const liveSettler = engine.units.find((u) => u.id === settler.id);
    expect(liveSettler, 'settler survives the walk').toBeDefined();
    expect(liveSettler!._aiGuardId).toBe(warrior!.id);
    const liveGuard = engine.units.find((u) => u.id === warrior!.id);
    expect(liveGuard!._aiGuardFor).toBe(settler.id);
    // The guard closed with its walker instead of wandering off.
    const dist = Math.max(
      Math.abs(liveGuard!.col - liveSettler!.col),
      Math.abs(liveGuard!.row - liveSettler!.row),
    );
    expect(dist).toBeLessThanOrEqual(6);
  });

  it('holds an exposed settler with no guard available instead of walking in', async () => {
    const { world, engine, settler } = await stageScenario(false);
    const start = { col: settler.col, row: settler.row };
    await world.runTurns(1);

    const liveSettler = engine.units.find((u) => u.id === settler.id);
    expect(liveSettler, 'settler survives by holding').toBeDefined();
    expect(liveSettler!._aiGuardId ?? null).toBeNull();
    expect({ col: liveSettler!.col, row: liveSettler!.row }).toEqual(start);
  });
});
