/**
 * Small shared fixtures for fixed-alliance tests.
 *
 * `TeamManager` only needs a handful of engine fields, so a plain object is
 * enough for the membership/diplomacy tests. Combat and save/load tests use a
 * real `GameEngine` because they exercise real engine code paths.
 */
import { vi } from 'vitest';
import { TeamManager } from '@/game/engine/TeamManager';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';

/** A complete `GameSettings` fixture with fixed alliances enabled. */
export function teamSettings(
  assignments: number[],
  civCount = assignments.length,
): import('@/game/engine/GameEngine').GameSettings {
  return {
    difficulty: 'normal',
    mapType: 'NORMAL_SKIRMISH',
    numberOfCivilizations: civCount,
    playerCivilization: 0,
    startingYear: -4000,
    startingGold: 100,
    fixedAlliances: true,
    teamAssignments: assignments,
  };
}

export interface TeamTestEngine {
  civilizations: Array<Record<string, unknown>>;
  units: Array<Record<string, unknown>>;
  cities: Array<Record<string, unknown>>;
  teamManager: TeamManager;
  diplomacyManager: DiplomacyManager;
  roundManager: { getRoundNumber: () => number };
  onStateChange: ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal engine with `civCount` civilizations, locked teams given by
 * `assignments`, and an initialized diplomacy manager. Every teammate pair is
 * already forced into an alliance by `applyTeamInvariants()`.
 */
export function makeTeamEngine(
  civCount = 3,
  assignments: number[] = [0, 0, 1],
): TeamTestEngine {
  const civilizations = Array.from({ length: civCount }, (_, id) => ({
    id,
    name: `Civ${id}`,
    isHuman: id === 0,
    isAlive: true,
    resources: { gold: 100 },
    technologies: [],
    personality: {
      aggression: 5,
      diplomacy: 5,
      military: 5,
      expansion: 5,
      science: 5,
      economy: 5,
    },
  }));

  const engine = {
    civilizations,
    units: [],
    cities: [],
    roundManager: { getRoundNumber: () => 1 },
    onStateChange: vi.fn(),
  } as unknown as TeamTestEngine;

  engine.teamManager = new TeamManager(engine as never);
  engine.teamManager.configure(teamSettings(assignments, civCount), civCount);
  engine.teamManager.applyToCivilizations();

  engine.diplomacyManager = new DiplomacyManager(engine as never);
  engine.diplomacyManager.initialize(civilizations.map((civ) => civ.id as number));
  engine.diplomacyManager.applyTeamInvariants();

  return engine;
}
