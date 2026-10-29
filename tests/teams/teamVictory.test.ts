import { describe, expect, it, vi } from 'vitest';
import { TeamManager } from '@/game/engine/TeamManager';
import { VictoryManager } from '@/game/engine/VictoryManager';
import type { GameResult } from '../../types/game';

function makeEngine(
  civCount = 3,
  assignments: number[] = [0, 0, 1],
  fixedAlliances = true,
) {
  const civilizations = Array.from({ length: civCount }, (_, id) => ({
    id,
    name: `Civ${id}`,
    isHuman: id === 0,
    isAlive: true,
    technologies: [] as string[],
    score: 0,
    peaceTurns: 0,
    warWith: new Set<number>(),
    resources: { gold: 0 },
  }));

  const engine: any = {
    civilizations,
    units: [] as Array<Record<string, unknown>>,
    cities: [] as Array<Record<string, unknown>>,
    isGameOver: false,
    currentTurn: 10,
    currentYear: -3000,
    teamManager: null,
    isCivAtWar: () => false,
    setPaused: vi.fn(),
    onStateChange: vi.fn(),
    storeActions: {
      setGameResult: vi.fn((result: GameResult) => { engine.lastResult = result; }),
      updateGameState: vi.fn(),
      updateCivilizations: vi.fn(),
    },
    lastResult: undefined as GameResult | undefined,
  };

  engine.teamManager = new TeamManager(engine);
  engine.teamManager.configure(
    { fixedAlliances, teamAssignments: assignments },
    civCount,
  );
  engine.teamManager.applyToCivilizations();

  return engine;
}

function giveUnit(engine: any, civId: number, id = `u${civId}`): void {
  engine.units.push({ id, civilizationId: civId, isDefeated: false });
}

function giveCity(engine: any, civId: number, id = `c${civId}`): void {
  engine.cities.push({ id, civilizationId: civId, col: 0, row: 0, population: 1 });
}

describe('team victory and defeat', () => {
  it('makes the whole team win when the last rival team falls', () => {
    const engine = makeEngine(3, [0, 0, 1]);
    giveUnit(engine, 0);
    giveUnit(engine, 1);
    const victory = new VictoryManager(engine);

    expect(victory.evaluateEndOfTurn()).toBe(true);
    expect(engine.lastResult?.outcome).toBe('victory');
    expect(engine.lastResult?.teamId).toBe(0);
    expect(engine.lastResult?.teamName).toBe('Team 1');
    expect(engine.lastResult?.civilizationIds).toEqual([0, 1]);
    expect(engine.lastResult?.civNames).toEqual(['Civ0', 'Civ1']);
    expect(engine.lastResult?.isHuman).toBe(true);
  });

  it('lets an eliminated human spectate while a teammate survives', () => {
    const engine = makeEngine(3, [0, 0, 1]);
    giveUnit(engine, 1);
    giveUnit(engine, 2);
    const victory = new VictoryManager(engine);

    expect(victory.evaluateEndOfTurn()).toBe(false);
    expect(engine.isGameOver).toBe(false);
    expect(engine.lastResult).toBeUndefined();
    expect(engine.civilizations[0].isAlive).toBe(false);
    expect(engine.civilizations[1].isAlive).toBe(true);
  });

  it('makes the whole team lose when every member is gone', () => {
    const engine = makeEngine(3, [0, 0, 1]);
    giveUnit(engine, 2);
    const victory = new VictoryManager(engine);

    expect(victory.evaluateEndOfTurn()).toBe(true);
    expect(engine.lastResult?.outcome).toBe('defeat');
    expect(engine.lastResult?.teamId).toBe(0);
    expect(engine.lastResult?.civilizationIds).toEqual([0, 1]);
  });

  it('awards a team moonshot to every member, even the one who did not build it', () => {
    const engine = makeEngine(3, [0, 0, 1]);
    giveUnit(engine, 0);
    giveUnit(engine, 1);
    giveUnit(engine, 2);
    engine.civilizations[1].technologies = ['moonshot'];
    const victory = new VictoryManager(engine);

    expect(victory.evaluateEndOfTurn()).toBe(true);
    expect(engine.lastResult?.outcome).toBe('victory');
    expect(engine.lastResult?.reason).toBe('moonshot');
    expect(engine.lastResult?.teamId).toBe(0);
    expect(engine.lastResult?.civilizationIds).toEqual([0, 1]);
  });

  it('keeps free-for-all defeat immediate when fixed alliances are off', () => {
    const engine = makeEngine(3, [0, 0, 1], false);
    giveUnit(engine, 1);
    giveUnit(engine, 2);
    const victory = new VictoryManager(engine);

    expect(victory.evaluateEndOfTurn()).toBe(true);
    expect(engine.lastResult?.outcome).toBe('defeat');
    expect(engine.lastResult?.teamId).toBeUndefined();
    expect(engine.lastResult?.civilizationIds).toBeUndefined();
  });

  it('does not end an all-AI team game when two teams still stand', () => {
    const engine = makeEngine(4, [0, 0, 1, 1]);
    engine.civilizations.forEach((civ: { isHuman: boolean }) => { civ.isHuman = false; });
    giveUnit(engine, 0);
    giveUnit(engine, 2);
    const victory = new VictoryManager(engine);

    expect(victory.evaluateEndOfTurn()).toBe(false);
    expect(engine.isGameOver).toBe(false);
  });

  it('treats a team with one surviving unit as alive', () => {
    const engine = makeEngine(3, [0, 0, 1]);
    giveUnit(engine, 0);
    giveCity(engine, 1);
    const victory = new VictoryManager(engine);

    // Team 0 has two operational members, team 1 none: team 0 wins.
    expect(victory.evaluateEndOfTurn()).toBe(true);
    expect(engine.lastResult?.teamId).toBe(0);
  });
});
