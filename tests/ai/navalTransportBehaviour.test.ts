/**
 * Transports must not pile up in one corner of the map.
 *
 * The bug this pins: on an archipelago map, every civ took `islands[0]` — the
 * first colonisable island in the list, which is sorted by distance to that
 * civ's OWN city, so it was not even the same ranking for everyone. Three civs
 * ended up claiming one rock, all their ferries converged on the same couple of
 * water tiles beside it, and because the missions could never complete nobody
 * ever gave up: the hulls milled around that anchorage for the whole game.
 *
 * Two rules hold it together:
 *   - an island another civ is already ferrying a settler to is not available;
 *   - a hull that stops closing on its destination gives the objective up and
 *     sails somewhere else, instead of being re-issued the same unreachable
 *     tile every turn.
 */
import { describe, expect, it } from 'vitest';
import { makeEngine } from '../helpers/world';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';

const isTransport = (type: string): boolean => (UNIT_PROPERTIES[type]?.transportCapacity ?? 0) > 0;

interface ColonyMissionLike {
  targetLandmassId: number;
  stage: string;
  waterTile: { col: number; row: number };
}

const missionsOf = (
  engine: { getPlayerStorage(id: number): { turnData?: Record<string, unknown> } | undefined },
  civId: number,
): ColonyMissionLike | undefined =>
  engine.getPlayerStorage(civId)?.turnData?.colonyMission as ColonyMissionLike | undefined;

describe('an island can be claimed by one civ at a time', () => {
  it('is not offered to a civ while a rival is already ferrying to it', async () => {
    const world = await makeEngine({ mapType: 'AI_VS_AI_NAVAL', numberOfCivilizations: 2, seed: 4242 });
    const engine = world.engine;
    await world.runTurns(3);

    // The engine needs to have seen something colonisable before a claim means
    // anything, so reveal the map for both civs.
    for (const civ of engine.civilizations) {
      const storage = engine.getPlayerStorage(civ.id);
      if (storage?.explored) storage.explored.fill(true);
    }
    const owner = engine.civilizations[0].id;
    const rival = engine.civilizations[1].id;
    const forOwner = engine.getColonizableIslands(owner);
    expect(forOwner.length).toBeGreaterThan(0);
    const claimed = forOwner[0];

    // The OWNER is now ferrying a settler to that island.
    const ownerStorage = engine.getPlayerStorage(owner);
    expect(ownerStorage).toBeDefined();
    ownerStorage!.turnData.colonyMission = {
      settlerId: 's', ferryId: 'f', targetLandmassId: claimed.landmassId,
      landTile: claimed.landTile, waterTile: claimed.waterTile, stage: 'gather',
    };

    expect(engine.getColonizableIslands(rival).map(i => i.landmassId))
      .not.toContain(claimed.landmassId);
    // …while the civ that holds the claim still sees it as its own target.
    expect(engine.getColonizableIslands(owner).map(i => i.landmassId))
      .toContain(claimed.landmassId);
  });
});

describe('transports at sea', () => {
  it('never crowd one tile and never all migrate to a map corner', async () => {
    const world = await makeEngine({ mapType: 'AI_VS_AI_NAVAL', numberOfCivilizations: 4, seed: 4242 });
    const engine = world.engine;
    const width = engine.map?.width ?? 96;
    const height = engine.map?.height ?? 60;
    await world.runTurns(3);

    // Enough hulls that "all of them steer the same way" becomes visible.
    for (const civ of engine.civilizations) {
      for (let i = 0; i < 2; i++) {
        const city = engine.cities.find(c => c.civilizationId === civ.id);
        if (!city) continue;
        const spot = world.landNear(city.col, city.row, 3);
        world.spawnUnit({
          id: `hull-${civ.id}-${i}`, type: 'ferry', civilizationId: civ.id,
          col: spot.col, row: spot.row,
        });
      }
      const city = engine.cities.find(c => c.civilizationId === civ.id);
      if (city) {
        world.spawnUnit({
          id: `settler-${civ.id}`, type: 'settler', civilizationId: civ.id,
          col: city.col, row: city.row,
        });
      }
    }

    let worstSharing = 0;
    // Fraction of the fleet sitting in one corner. A hull whose home shore is
    // the corner may legitimately be there; the bug was the whole fleet.
    let worstCornerShare = 0;
    // Hulls within a small box of each other. Civ1 lets units stack, so sharing
    // a tile is legal; a whole flotilla inside one anchorage is the bug.
    let worstCluster = 0;
    for (let turn = 1; turn <= 30; turn++) {
      await world.runTurns(1);
      const hulls = engine.units.filter(u => isTransport(u.type) && !u.isDefeated);
      if (hulls.length < 2) continue;

      const perTile = new Map<string, number>();
      for (const h of hulls) {
        const key = `${h.col},${h.row}`;
        perTile.set(key, (perTile.get(key) ?? 0) + 1);
      }
      worstSharing = Math.max(worstSharing, ...perTile.values());
      // "Corner" = a tenth of the map in each axis: the old bug stacked them
      // against (0,0) because the patrol scan began at the top-left diagonal.
      const corner = hulls.filter(h => h.col < width / 10 && h.row < height / 10).length;
      worstCornerShare = Math.max(worstCornerShare, corner / hulls.length);

      for (const anchor of hulls) {
        const near = hulls.filter(h => Math.abs(h.col - anchor.col) <= 3 && Math.abs(h.row - anchor.row) <= 3).length;
        worstCluster = Math.max(worstCluster, near);
      }

      // Two civs must never be ferrying to the same island at once.
      const claims = new Map<number, number>();
      for (const civ of engine.civilizations) {
        const mission = missionsOf(engine, civ.id);
        if (!mission) continue;
        claims.set(mission.targetLandmassId, (claims.get(mission.targetLandmassId) ?? 0) + 1);
      }
      for (const [, holders] of claims) expect(holders).toBeLessThanOrEqual(1);
    }

    // Bounds, not exact numbers: the map is pinned but combat and several AI
    // decisions are not, so a run's fleet can be in a slightly different place
    // each time. The per-turn "one civ per island" assertion above is the exact
    // one — it is what makes two civs' ferries converge on one anchorage — and
    // these three only have to catch a mass exodus into one corner.
    expect(worstSharing).toBeLessThanOrEqual(2);
    expect(worstCornerShare).toBeLessThan(0.6);
    expect(worstCluster).toBeLessThanOrEqual(4);
  }, 900000);
});