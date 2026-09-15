import { describe, it, expect, beforeEach } from 'vitest';
import { ResearchManager, MIN_RESEARCH_TURNS, MAX_RESEARCH_TURNS } from '@/game/engine/ResearchManager';

/**
 * Civ I research model: tech cost scaling (map/difficulty/tech-count), beaker
 * modifiers (known civs + prerequisites), and the 4-turn minimum / 32-turn
 * maximum.
 */
function makeEngine(overrides: Record<string, any> = {}): any {
  const civ = (id: number, techs: string[]): any => ({
    id,
    isAlive: true,
    technologies: [...techs],
  });
  return {
    map: { width: 80, height: 50 },
    gameSettings: { difficulty: 'PRINCE' },
    civilizations: [
      { ...civ(0, ['irrigation', 'mining', 'roads']), name: 'Americans', isHuman: true },
      { ...civ(1, ['irrigation', 'mining', 'roads', 'pottery']), name: 'Aztecs', isAI: true },
    ],
    diplomacyManager: {
      getStatus: (a: number, b: number) => (a === 0 && b === 1 ? 'peace' : undefined),
    },
    technologies: [
      { id: 'pottery', cost: 20, prerequisites: [], researched: false },
      { id: 'alphabet', cost: 40, prerequisites: [], researched: false },
      { id: 'writing', cost: 60, prerequisites: ['alphabet'], researched: false },
    ],
    ...overrides,
  };
}

describe('ResearchManager', () => {
  let engine: any;
  let rm: ResearchManager;

  beforeEach(() => {
    engine = makeEngine();
    rm = new ResearchManager(engine);
  });

  describe('tech cost scaling', () => {
    it('mapTechRate is higher for bigger maps', () => {
      const small = new ResearchManager(makeEngine({ map: { width: 20, height: 20 } }));
      const big = new ResearchManager(makeEngine({ map: { width: 100, height: 80 } }));
      expect(small.mapTechRate()).toBeLessThanOrEqual(big.mapTechRate());
      expect(small.mapTechRate()).toBeGreaterThanOrEqual(1);
      expect(big.mapTechRate()).toBeLessThanOrEqual(3);
    });

    it('difficulty factor is higher (cheaper) on easier difficulties', () => {
      const chief = new ResearchManager(makeEngine({ gameSettings: { difficulty: 'CHIEFTAIN' } }));
      const emperor = new ResearchManager(makeEngine({ gameSettings: { difficulty: 'EMPEROR' } }));
      expect(chief.difficultyFactor()).toBeGreaterThan(emperor.difficultyFactor());
    });

    it('effectiveTechCost scales base cost by map rate and difficulty', () => {
      const civ = engine.civilizations[0];
      const tech = engine.technologies[0]; // pottery, base 20
      // 80x50 → mapRate 3; PRINCE → 1.0 → cost = 20*3 = 60.
      expect(rm.effectiveTechCost(civ, tech)).toBeGreaterThan(20);
    });

    it('a civ behind the leader gets a cost bonus; the leader pays more', () => {
      // civ 0 has 3 techs, civ 1 has 4 → civ 0 factor = 1 + (3-4)*0.1 = 0.9.
      const behind = rm.effectiveTechCost(engine.civilizations[0], engine.technologies[0]);
      const leader = rm.effectiveTechCost(engine.civilizations[1], engine.technologies[0]);
      expect(behind).toBeLessThan(leader);
    });
  });

  describe('beaker modifiers', () => {
    it('knownCivsModifier < 1.0 when a contacted civ knows the tech', () => {
      const civ = engine.civilizations[0];
      const tech = engine.technologies[0]; // pottery — civ 1 knows it
      expect(rm.knownCivsModifier(civ, tech)).toBeLessThan(1);
    });

    it('knownCivsModifier is 1.0 when no contacted civ knows the tech', () => {
      const civ = engine.civilizations[0];
      const tech = engine.technologies[1]; // alphabet — nobody has it
      expect(rm.knownCivsModifier(civ, tech)).toBe(1);
    });

    it('prerequisitesModifier < 1.0 when the civ is missing prerequisites', () => {
      const civ = { ...engine.civilizations[0], technologies: [] };
      const writing = engine.technologies[2]; // requires alphabet
      expect(rm.prerequisitesModifier(civ, writing)).toBeLessThan(1);
    });

    it('prerequisitesModifier is 1.0 when all prerequisites are researched', () => {
      const civ = { ...engine.civilizations[0], technologies: ['alphabet'] };
      const writing = engine.technologies[2]; // requires alphabet
      expect(rm.prerequisitesModifier(civ, writing)).toBe(1);
    });

    it('prerequisitesModifier is 1.0 for techs with no prerequisites', () => {
      expect(rm.prerequisitesModifier(engine.civilizations[0], engine.technologies[0])).toBe(1);
    });

    it('beakersApplied follows the Civ 1 formula', () => {
      // 4 base beakers, known-modifier 0.9, no prereqs → floor(floor(5*0.9)*1) = 4.
      const civ = engine.civilizations[0];
      const pottery = engine.technologies[0];
      const applied = rm.beakersApplied(civ, pottery, 4);
      expect(applied).toBe(Math.floor(Math.floor((4 + 1) * rm.knownCivsModifier(civ, pottery)) * rm.prerequisitesModifier(civ, pottery)));
      expect(applied).toBeGreaterThanOrEqual(0);
    });
  });

  describe('advanceResearch (turn caps)', () => {
    it('accumulates progress and completes at the effective cost', () => {
      const civ = engine.civilizations[0];
      civ.currentResearch = engine.technologies[0];
      civ.researchProgress = 0;
      const cost = rm.effectiveTechCost(civ, engine.technologies[0]);

      let completed = null;
      let guard = 0;
      while (!completed && guard++ < 200) {
        completed = rm.advanceResearch(civ, engine.technologies[0], 10);
      }
      expect(completed).toBe('pottery');
      expect(guard).toBeLessThanOrEqual(cost);
    });

    it('research progress is constant — no min-turns slowdown near completion', () => {
      const civ = engine.civilizations[0];
      civ.currentResearch = engine.technologies[0];
      civ.researchProgress = 0;

      // With huge science, research should complete in very few turns
      // (no more 4-turn minimum cap).
      let completed = false;
      for (let turn = 0; turn < 3; turn++) {
        completed = !!rm.advanceResearch(civ, engine.technologies[0], 1000);
        if (completed) break;
      }
      expect(completed).toBe(true);
    });

    it('never takes longer than MAX_RESEARCH_TURNS even with zero science', () => {
      const civ = engine.civilizations[0];
      civ.currentResearch = engine.technologies[1]; // alphabet, cost 40
      civ.researchProgress = 0;

      let completed = false;
      let turns = 0;
      for (; turns < MAX_RESEARCH_TURNS; turns++) {
        if (rm.advanceResearch(civ, engine.technologies[1], 0)) {
          completed = true;
          break;
        }
      }
      expect(completed).toBe(true);
      expect(turns).toBeLessThanOrEqual(MAX_RESEARCH_TURNS);
    });
  });

  describe('estimatedTurns (UI)', () => {
    it('higher per-turn science gives fewer estimated turns', () => {
      const civ = engine.civilizations[0];
      civ.researchProgress = 0;
      const tech = engine.technologies[0];
      const slow = rm.estimatedTurns(civ, tech, 2);
      const fast = rm.estimatedTurns(civ, tech, 20);
      expect(fast).toBeLessThanOrEqual(slow);
      expect(slow).toBeGreaterThanOrEqual(MIN_RESEARCH_TURNS);
      expect(slow).toBeLessThanOrEqual(MAX_RESEARCH_TURNS);
    });

    it('returns 0 when the tech is already complete', () => {
      const civ = engine.civilizations[0];
      civ.researchProgress = 100000;
      expect(rm.estimatedTurns(civ, engine.technologies[0], 5)).toBe(0);
    });
  });
});
