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
