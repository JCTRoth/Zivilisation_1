/**
 * The AI's research choice beat the engine's legacy picker.
 *
 * `Civilization.completeTechnology` — reached from `updateScience` every turn a
 * tech finishes — auto-calls `selectNextResearch()`, a second and much older AI
 * picker that lives inside the Civilization class. It scores with
 * `evaluateTechnology`, which knows nothing about the caravan / naval / fishing /
 * nuclear hooks, the civ's strategy, or `caravanRelevanceForCiv`.
 *
 * The consequence, measured: a civ with caravan relevance 3, `currency` already
 * researched and `trade` scoring 85 (the highest candidate by 60 points)
 * researched `alphabet` instead. `AIManager`'s research phase used to read
 * `civ.currentResearch` as "already decided" and skip its own scoring entirely,
 * so the trade chain — and every other hook — was silently unrepresented in
 * roughly half of all research picks.
 *
 * The rule pinned here: **the AI scores every turn, and replaces a choice it did
 * not make; a choice it did make is left alone** (so in-progress beakers are not
 * reset).
 */
import { describe, it, expect, vi } from 'vitest';
import { AIManager } from '@/game/engine/AI/AIManager';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import type { Civilization, City, Unit } from '../../types/game';

/** A one-civ world whose current research may have been set by the LEGACY picker. */
const legacyWorld = (opts: {
  legacyPick?: string | null;
  civId?: number;
} = {}) => {
  const civId = opts.civId ?? 1;
  const civ = {
    id: civId,
    name: 'TestCiv',
    isHuman: false,
    isAI: true,
    technologies: ['pottery', 'bronze_working', 'currency'],
    currentResearch: opts.legacyPick ? { id: opts.legacyPick } : null,
    resources: { gold: 50, science: 3, food: 0, production: 0, trade: 0 },
    taxRate: 50, scienceRate: 30, luxuryRate: 20,
    productionProfile: 'balanced_growth',
    personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5 },
  } as unknown as Civilization;

  const cities = [{
    id: 'c0', name: 'Home', civilizationId: civId, col: 3, row: 3,
    population: 4, buildings: [], tradeRoutes: [], currentProduction: null,
    buildQueue: [], autoProduction: true,
  }, {
    // A rival city: `caravanRelevanceForCiv` returns 0 when this civ is the only
    // one on the map, and the hook that makes `trade` win is the whole point.
    id: 'foe', name: 'Thebes', civilizationId: 2, col: 12, row: 12,
    population: 6, buildings: [], tradeRoutes: [], currentProduction: null,
    buildQueue: [], autoProduction: true,
  }] as unknown as City[];
  const units = [{
    id: 'u1', type: 'warrior', civilizationId: civId, col: 3, row: 3,
    attack: 1, defense: 1, movesRemaining: 1,
  }] as unknown as Unit[];

  const setResearch = vi.fn(() => true);
  const engine = {
    cities, units,
    civilizations: [undefined as unknown as Civilization, civ],
    activePlayer: civId,
    isPaused: false,
    map: { width: 20, height: 20 },
    squareGrid: {
      squareDistance: (a: number, b: number, c: number, d: number) =>
        Math.max(Math.abs(a - c), Math.abs(b - d)),
      getNeighbors: () => [], isValidSquare: () => true, findPath: () => [],
    },
    roundManager: { getRoundNumber: () => 40 },
    currentYear: -2000,
    gameSettings: { difficulty: 'PRINCE', mapType: 'CONTINENT' },
    getPlayerStorage: () => ({ turnData: {}, visibility: [], explored: [] }),
    getTileAt: () => ({ type: 'grassland', terrain: 'grassland', col: 0, row: 0, visible: true, explored: true }),
    getCityAt: () => null,
    getUnitAt: () => null,
    diplomacyManager: { isAtWar: () => false, hasContacted: () => true },
    setResearch,
    isResearchUnlocked: () => true,
    aiManager: undefined,
    governmentManager: null,
    log: () => {},
    emit: () => {},
  };
  return { engine, civ, setResearch };
};

/** Run the AI turn and surface any throw (the turn's own catch swallows it). */
const runTurn = async (engine: unknown, civId = 1): Promise<void> => {
  const ai = new AIManager(engine as never);
  let thrown: unknown = null;
  try {
    await (ai as unknown as { runAITurn: (id: number) => Promise<void> }).runAITurn(civId);
  } catch (err) { thrown = err; }
  // A later phase may throw on a mock (diplomacy, naval, …). What matters is
  // that the RESEARCH phase ran, which it did if we got as far as diplomacy.
  if (thrown && !String((thrown as Error).message).includes('processAIDiplomacy')) {
    throw new Error(`runAITurn threw: ${(thrown as Error).stack ?? String(thrown)}`);
  }
};

describe('the scored pick wins over the legacy picker', () => {
  it('trade is the highest-scoring available tech in this world', () => {
    // Sanity for the rest of the suite: the caravan hook really does make
    // `trade` the standout candidate, by a wide margin.
    const { civ } = legacyWorld({ legacyPick: 'alphabet' });
    const gs = {
      currentYear: -2000, roundNumber: 40, numCities: 1,
      numEnemyCitiesKnown: 0, isAtWar: false, hasLibrary: false,
      totalScience: 3, caravanRelevance: 3,
    };
    const pick = AIResearch.selectResearch(civ, 'balanced_growth', gs as never);
    expect(pick).toBe('trade');
  });

  it('replaces the legacy picker\'s choice with the scored one', async () => {
    const { engine, setResearch } = legacyWorld({ legacyPick: 'alphabet' });
    await runTurn(engine);
    // The scored choice is `trade`; the legacy picker had staked out `alphabet`.
    expect(setResearch).toHaveBeenCalledWith(1, 'trade');
  });

  it('leaves a research the AI itself chose alone', async () => {
    // The same world, but the civ's current research IS the AI's pick. On the
    // FIRST turn the AI cannot know that (its record is empty), so it re-asserts
    // it — that is correct and harmless, `setResearch` re-commits the same tech.
    // The thing that must NOT happen is the SECOND turn: the AI's record now
    // holds `trade`, so re-scoring would only reset the beakers already spent.
    const { engine, setResearch } = legacyWorld({ legacyPick: 'trade' });
    const ai = new AIManager(engine as never);
    const run = async () => {
      let thrown: unknown = null;
      try {
        await (ai as unknown as { runAITurn: (id: number) => Promise<void> }).runAITurn(1);
      } catch (err) { thrown = err; }
      if (thrown && !String((thrown as Error).message).includes('processAIDiplomacy')) {
        throw new Error(`runAITurn threw: ${(thrown as Error).stack ?? String(thrown)}`);
      }
    };
    await run();
    setResearch.mockClear();
    await run();
    expect(setResearch).not.toHaveBeenCalled();
  });

  it('starts research when nothing is in progress', async () => {
    const { engine, setResearch } = legacyWorld({ legacyPick: null });
    await runTurn(engine);
    expect(setResearch).toHaveBeenCalledWith(1, 'trade');
  });
});
