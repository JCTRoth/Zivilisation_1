/**
 * Spectator games — starting a game with NO human player.
 *
 * The setup lobby may flip every seat (including seat 0) to AI. Such a game
 * plays itself: Dev Mode is forced on (the whole board must be observable),
 * every civ is AI-controlled, and the game ends with an AI victory rather
 * than a defeat overlay. These tests pin the rule at its three layers:
 * the shared predicate (`isSpectatorGame`), the setup-facing `makeEngine`
 * harness, and `GameEngine.initialize` itself.
 */
import { describe, it, expect } from 'vitest';
import { isSpectatorGame, isAutoScenario } from '@/data/GameConstants';
import type GameEngine from '@/game/engine/GameEngine';
import { makeEngine } from './helpers/world';

describe('isSpectatorGame', () => {
  it('an AI-vs-AI map is a spectator game whatever the seats say', () => {
    expect(isSpectatorGame({ mapType: 'AI_VS_AI' })).toBe(true);
    expect(isSpectatorGame({ mapType: 'AI_VS_AI', humanPlayerIds: [0] })).toBe(true);
  });

  it('an explicit empty human list makes any map a spectator game', () => {
    expect(isSpectatorGame({ mapType: 'NORMAL_SKIRMISH', humanPlayerIds: [] })).toBe(true);
    expect(isSpectatorGame({ mapType: 'EARTH', humanPlayerIds: [] })).toBe(true);
  });

  it('unset human seats keep the single-player default (seat 0)', () => {
    expect(isSpectatorGame({ mapType: 'NORMAL_SKIRMISH' })).toBe(false);
    expect(isSpectatorGame({ mapType: 'NORMAL_SKIRMISH', humanPlayerIds: undefined })).toBe(false);
    expect(isSpectatorGame({ mapType: 'NORMAL_SKIRMISH', humanPlayerIds: [0] })).toBe(false);
    expect(isSpectatorGame({ mapType: 'NORMAL_SKIRMISH', humanPlayerIds: [0, 2] })).toBe(false);
    expect(isSpectatorGame(null)).toBe(false);
  });

  it('isAutoScenario keeps its narrower meaning', () => {
    expect(isAutoScenario('AI_VS_AI')).toBe(true);
    expect(isAutoScenario('NORMAL_SKIRMISH')).toBe(false);
  });
});

describe('all-AI games', () => {
  it('no human seat forces Dev Mode and makes every civ AI', async () => {
    const world = await makeEngine({
      mapType: 'NORMAL_SKIRMISH',
      numberOfCivilizations: 3,
      seed: 1234,
      humanPlayerIds: [],
    });
    const e = world.engine;

    expect(e.devMode, 'Dev Mode forced for an all-AI game').toBe(true);
    expect(e.civilizations.every((c) => !c.isHuman)).toBe(true);
    expect(e.civilizations.every((c) => c.isAI)).toBe(true);
    expect(isSpectatorGame(e.gameSettings)).toBe(true);
  });

  it('plays itself for a few rounds without needing a player', async () => {
    const world = await makeEngine({
      mapType: 'NORMAL_SKIRMISH',
      numberOfCivilizations: 3,
      seed: 1234,
      humanPlayerIds: [],
    });
    await world.runTurns(3);
    expect(world.engine.isGameOver).toBe(false);
    expect(world.engine.turnManager.getRoundNumber()).toBeGreaterThan(1);
  });

  it('a team game with no human seat also boots and runs', async () => {
    const world = await makeEngine({
      mapType: 'NORMAL_SKIRMISH',
      numberOfCivilizations: 4,
      seed: 1234,
      humanPlayerIds: [],
      fixedAlliances: true,
      teamAssignments: [0, 1, 0, 1],
    });
    const e = world.engine;
    expect(e.devMode).toBe(true);
    expect(e.teamManager.enabled).toBe(true);
    await world.runTurns(2);
    expect(e.isGameOver).toBe(false);
  });

  it('a human seat still wins: dev mode stays off and seat 0 is human', async () => {
    const world = await makeEngine({
      mapType: 'NORMAL_SKIRMISH',
      numberOfCivilizations: 3,
      seed: 1234,
      humanPlayerIds: [0],
    });
    const e = world.engine;

    expect(e.devMode, 'Dev Mode must NOT be forced when a human sits down').toBe(false);
    expect(e.civilizations[0].isHuman).toBe(true);
    expect(e.civilizations.slice(1).every((c) => !c.isHuman)).toBe(true);
    expect(isSpectatorGame(e.gameSettings)).toBe(false);
  });

  it('an AI-only seat assignment (seat 1 human) is honoured', async () => {
    const world = await makeEngine({
      mapType: 'NORMAL_SKIRMISH',
      numberOfCivilizations: 3,
      seed: 1234,
      humanPlayerIds: [1],
    });
    const e = world.engine;

    expect(e.devMode).toBe(false);
    expect(e.civilizations[1].isHuman).toBe(true);
    expect(e.civilizations[0].isHuman).toBe(false);
    expect(e.civilizations[2].isHuman).toBe(false);
  });
});

/**
 * The vision split in a spectator game: the watching human gets the WHOLE board
 * (Dev Mode is forced on and the store renders every tile lit), but each AI
 * keeps its OWN fog of war for decision-making. Before this, `devMode` short-
 * circuited `isVisibleToPlayer` / `isExploredByPlayer` / `getVisibleUnits` /
 * `getVisibleCities` for everybody, so the AIs in an AI-vs-AI run played with
 * perfect information — they could path through unexplored ground and see every
 * enemy unit on the map.
 */
describe('spectator vision split — human sees all, AIs keep their fog', () => {
  /** Chebyshev distance from (col,row) to the nearest unit/city the civ owns. */
  const distanceToOwnPresence = (
    e: GameEngine,
    civId: number,
    col: number,
    row: number,
  ): number => {
    const own = [
      ...e.units.filter((u) => u.civilizationId === civId && u.isDefeated !== true),
      ...e.cities.filter((c) => c.civilizationId === civId),
    ];
    if (own.length === 0) return Number.POSITIVE_INFINITY;
    return Math.min(
      ...own.map((o) => Math.max(Math.abs(o.col - col), Math.abs(o.row - row))),
    );
  };

  /** The tile furthest from everything `civId` owns — i.e. its darkest ground. */
  const darkestTile = (
    e: GameEngine,
    civId: number,
  ): { col: number; row: number; distance: number } => {
    const width = e.map!.width;
    const height = e.map!.height;
    let best = { col: 0, row: 0, distance: -1 };
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const distance = distanceToOwnPresence(e, civId, col, row);
        if (distance > best.distance) best = { col, row, distance };
      }
    }
    return best;
  };

  it('AI_VS_AI forces Dev Mode ON yet every AI still has fog of war', async () => {
    const world = await makeEngine({
      mapType: 'AI_VS_AI',
      numberOfCivilizations: 3,
      seed: 1234,
      humanPlayerIds: [],
    });
    const e = world.engine;

    expect(e.devMode, 'Dev Mode is forced for the spectator').toBe(true);
    e.updateVisibility();

    for (const civ of e.civilizations.filter((c) => c.id >= 0)) {
      const dark = darkestTile(e, civ.id);
      expect(dark.distance, `civ ${civ.id} has out-of-sight ground`).toBeGreaterThan(2);

      expect(
        e.isVisibleToPlayer(civ.id, dark.col, dark.row),
        `civ ${civ.id} must NOT see a tile beyond its own sight`,
      ).toBe(false);
      expect(
        e.isExploredByPlayer(civ.id, dark.col, dark.row),
        `civ ${civ.id} must NOT have explored a tile beyond its own sight`,
      ).toBe(false);

      const ownUnit = e.units.find((u) => u.civilizationId === civ.id && u.isDefeated !== true);
      if (ownUnit) {
        expect(e.isVisibleToPlayer(civ.id, ownUnit.col, ownUnit.row), 'own ground stays lit').toBe(true);
      }
    }
  });

  it('getVisibleUnits / getVisibleCities stay fog-filtered in a spectator game', async () => {
    const world = await makeEngine({
      mapType: 'AI_VS_AI',
      numberOfCivilizations: 3,
      seed: 1234,
      humanPlayerIds: [],
    });
    const e = world.engine;
    expect(e.devMode).toBe(true);
    e.updateVisibility();

    const me = 0;
    const hiddenUnit = e.units.find(
      (u) =>
        u.civilizationId !== me &&
        u.civilizationId >= 0 &&
        u.isDefeated !== true &&
        !e.isVisibleToPlayer(me, u.col, u.row),
    );
    expect(hiddenUnit, 'an enemy unit sits outside civ 0 sight').toBeDefined();
    expect(e.getVisibleUnits(me).some((u) => u.id === hiddenUnit!.id)).toBe(false);
    expect(e.getVisibleUnits(me).length).toBeLessThan(e.units.length);

    const hiddenCity = e.cities.find(
      (c) => c.civilizationId !== me && !e.isExploredByPlayer(me, c.col, c.row),
    );
    if (hiddenCity) {
      expect(e.getVisibleCities(me).some((c) => c.id === hiddenCity.id)).toBe(false);
    }
    expect(e.getVisibleCities(me).length).toBeLessThanOrEqual(e.cities.length);
  });

  it('Dev Mode still reveals everything in an ordinary human game', async () => {
    const world = await makeEngine({
      mapType: 'NORMAL_SKIRMISH',
      numberOfCivilizations: 2,
      seed: 1234,
      humanPlayerIds: [0],
    });
    const e = world.engine;

    expect(e.devMode, 'Dev Mode is off until we turn it on').toBe(false);
    expect(isSpectatorGame(e.gameSettings)).toBe(false);

    e.devMode = true;
    e.updateVisibility();

    const dark = darkestTile(e, 0);
    expect(e.isVisibleToPlayer(0, dark.col, dark.row), 'dev mode lights everything').toBe(true);
    expect(e.isExploredByPlayer(0, dark.col, dark.row), 'dev mode marks everything explored').toBe(true);
    expect(e.getVisibleUnits(0).length, 'every unit is handed over').toBe(e.units.length);
    expect(e.getVisibleCities(0).length, 'every city is handed over').toBe(e.cities.length);
  });
});
