/**
 * Nuclear delivery + endgame wiring: missions mate warheads with submarines,
 * production arms the endgame branch, research races Fission, and staged
 * late-game turns end in a mushroom cloud.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import type { City, Unit } from '../../types/game';

const G = 'grassland';
const O = 'ocean';

// Home island (cols 0-2), open ocean, enemy island (cols 27-29): strikes need
// delivery — nothing is within a warhead's own 16-tile flight.
const ROW = [...Array(3).fill(G), ...Array(24).fill(O), ...Array(3).fill(G)];
const THEATRE = [ROW, ROW, ROW, ROW, ROW];
const WIDTH = 30;
const HEIGHT = 5;

function makeTheatre() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(WIDTH, HEIGHT);
  e.map = {
    width: WIDTH,
    height: HEIGHT,
    tiles: THEATRE.flat().map((type, i) => {
      const col = i % WIDTH;
      const row = Math.floor(i / HEIGHT);
      return { id: `${col},${row}`, col, row, type, terrain: type, movement: 1, defense: 1 };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Bombards', isHuman: false, isAlive: true, technologies: ['nuclear_fission'], resources: { gold: 900 } },
    { id: 1, name: 'Targetia', isHuman: false, isAlive: true, technologies: [], resources: { gold: 900 } },
  ];
  e.diplomacyManager = new DiplomacyManager(e as GameEngine);
  e.diplomacyManager.initialize([0, 1]);
  e.initializePlayerStorage(0);
  e.initializePlayerStorage(1);
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number, pop = 6, buildings: string[] = []) {
  const city = {
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: pop,
    buildings,
    buildQueue: [],
    currentProduction: null,
    tradeRoutes: [],
  };
  engine.cities.push(city as never);
  return city as City;
}

function addUnit(engine: GameEngine, opts: Partial<Unit> & { id: string; col: number; row: number; civilizationId: number }) {
  const unit = {
    health: 100,
    isDefeated: false,
    attack: 1,
    defense: 1,
    movesRemaining: 3,
    movement: 1,
    type: 'warrior',
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

const addNuke = (engine: GameEngine, id: string, col: number, row: number, civId = 0) =>
  addUnit(engine, {
    id, type: 'nuclear', col, row, civilizationId: civId,
    attack: 99, defense: 0, movesRemaining: 16, movement: 16,
  });

const addSub = (engine: GameEngine, id: string, col: number, row: number, civId = 0) =>
  addUnit(engine, {
    id, type: 'submarine', col, row, civilizationId: civId,
    attack: 14, defense: 3, movesRemaining: 3, movement: 3,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ai = (engine: GameEngine) => engine.aiManager as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const production = (engine: GameEngine) => engine.autoProduction as any;

const ENDGAME = { id: 'nuclear_endgame', reasons: ['endgame'] } as const;

describe('nuclear delivery mission', () => {
  it('mates a warhead with a sub when no ready nuke covers the target', () => {
    const e = makeTheatre();
    addCity(e, 'Home', 1, 2, 0, 6);
    addCity(e, 'LosAlamos', 0, 0, 0, 3, ['manhattan_project']);
    addCity(e, 'Target', 28, 2, 1, 8);
    addNuke(e, 'n1', 1, 2);
    addSub(e, 's1', 4, 2);
    e.diplomacyManager.declareWar(0, 1);

    ai(e).updateNukeMission(e.civilizations[0], e.getPlayerStorage(0)!, ENDGAME);
    const mission = e.getPlayerStorage(0)!.turnData.nukeMission as {
      nukeId: string; subId: string | null; stage: string; targetCol: number; targetRow: number;
    };
    expect(mission).toBeTruthy();
    expect(mission.nukeId).toBe('n1');
    expect(mission.subId).toBe('s1');
    expect(mission.targetCol).toBe(28);
  });

  it('plans nothing when a ready warhead already covers the target', () => {
    const e = makeTheatre();
    addCity(e, 'Home', 1, 2, 0, 6);
    addCity(e, 'LosAlamos', 0, 0, 0, 3, ['manhattan_project']);
    addCity(e, 'Near', 10, 2, 1, 6);
    addNuke(e, 'n1', 1, 2);
    addSub(e, 's1', 4, 2);
    e.diplomacyManager.declareWar(0, 1);

    ai(e).updateNukeMission(e.civilizations[0], e.getPlayerStorage(0)!, ENDGAME);
    expect(e.getPlayerStorage(0)!.turnData.nukeMission).toBeUndefined();
  });

  it('loads the waiting warhead when the sub comes alongside', () => {
    const e = makeTheatre();
    addCity(e, 'Home', 1, 2, 0, 6);
    addCity(e, 'LosAlamos', 0, 0, 0, 3, ['manhattan_project']);
    addCity(e, 'Target', 28, 2, 1, 8);
    const nuke = addNuke(e, 'n1', 2, 2);
    const sub = addSub(e, 's1', 3, 2);
    e.diplomacyManager.declareWar(0, 1);
    const storage = e.getPlayerStorage(0)!;
    ai(e).updateNukeMission(e.civilizations[0], storage, ENDGAME);
    const mission = storage.turnData.nukeMission as { stage: string };
    expect(mission).toBeTruthy();
    // Sub already alongside the coastal warhead: boarding is immediate.
    expect(ai(e).tryNukeSubAction(sub, mission, storage)).toBe(true);
    expect(nuke.embarkedOn).toBe('s1');
    expect(mission.stage).toBe('sail');
  });

  it('fires from aboard inside 16 tiles and stands down', () => {
    const e = makeTheatre();
    addCity(e, 'Home', 1, 2, 0, 6);
    const target = addCity(e, 'Target', 28, 2, 1, 8);
    const nuke = addNuke(e, 'n1', 14, 2);
    const sub = addSub(e, 's1', 14, 2);
    e.diplomacyManager.declareWar(0, 1);
    expect(e.loadFerry(sub.id, nuke.id)).toBe(true);
    const storage = e.getPlayerStorage(0)!;
    storage.turnData.nukeMission = {
      nukeId: 'n1', subId: 's1', targetCol: 28, targetRow: 2, targetCityId: target.id, stage: 'sail',
    };
    // 14 tiles out: inside warhead range.
    expect(ai(e).tryNukeSubAction(sub, storage.turnData.nukeMission, storage)).toBe(true);
    expect(target.population).toBe(4);
    expect(storage.turnData.nukeMission).toBeUndefined();
  });

  it('holds fire from aboard past warhead range', () => {
    const e = makeTheatre();
    addCity(e, 'Home', 1, 2, 0, 6);
    addCity(e, 'Target', 28, 2, 1, 8);
    const nuke = addNuke(e, 'n1', 4, 2);
    const sub = addSub(e, 's1', 4, 2);
    e.diplomacyManager.declareWar(0, 1);
    expect(e.loadFerry(sub.id, nuke.id)).toBe(true);
    const storage = e.getPlayerStorage(0)!;
    storage.turnData.nukeMission = {
      nukeId: 'n1', subId: 's1', targetCol: 28, targetRow: 2, stage: 'sail',
    };
    // 24 tiles out: sail closer first.
    expect(ai(e).tryNukeSubAction(sub, storage.turnData.nukeMission, storage)).toBe(false);
    expect(e.units.some((u) => u.id === 'n1')).toBe(true);
  });

  it('sails a loaded sub to launch waters, an empty one to its warhead', () => {
    const e = makeTheatre();
    addCity(e, 'Home', 1, 2, 0, 6);
    addCity(e, 'Target', 28, 2, 1, 8);
    const nuke = addNuke(e, 'n1', 14, 2);
    const sub = addSub(e, 's1', 14, 2);
    e.diplomacyManager.declareWar(0, 1);
    const storage = e.getPlayerStorage(0)!;
    (storage.turnData as Record<string, unknown>).nukeMission = {
      nukeId: 'n1', subId: 's1', targetCol: 28, targetRow: 2, stage: 'sail',
    };
    expect(e.loadFerry(sub.id, nuke.id)).toBe(true);
    const launch = ai(e).chooseNavalDestination(sub);
    expect(launch).not.toBeNull();
    const grid = e.squareGrid!;
    expect(grid.chebyshevDistance(launch.col, launch.row, 28, 2)).toBeLessThanOrEqual(16);
    expect(String(e.getTileAt(launch.col, launch.row)?.type)).toBe('ocean');
  });
});

describe('endgame production', () => {
  it('builds warheads at peace once the endgame branch arms', () => {
    const e = makeTheatre();
    const city = addCity(e, 'Forge', 1, 1, 0, 4);
    addCity(e, 'LosAlamos', 0, 0, 0, 3, ['manhattan_project']);
    city.currentProduction = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 40 } as never;
    // No war — but the branch says arm.
    (e.getPlayerStorage(0)!.turnData as Record<string, unknown>).strategyBranch = 'nuclear_endgame';
    expect(production(e).shouldBuildNuclear(city)).toBe(true);
  });

  it('races Manhattan first while the wonder is still open', () => {
    const e = makeTheatre();
    const city = addCity(e, 'Forge', 1, 1, 0, 4);
    (e.getPlayerStorage(0)!.turnData as Record<string, unknown>).strategyBranch = 'nuclear_endgame';
    const item = production(e).buildManhattanProduction(city);
    expect(item?.itemType).toBe('manhattan_project');
  });

  it('builds siege guns, not infantry, for a walled plan target', () => {
    const e = makeTheatre();
    const city = addCity(e, 'Forge', 1, 1, 0, 4);
    (e.civilizations[0] as { technologies?: string[] }).technologies = ['steel', 'combustion', 'metallurgy'];
    addCity(e, 'Walled', 20, 2, 1, 6, ['city_walls']);
    (e.getPlayerStorage(0)!.turnData as Record<string, unknown>).offensivePlan = {
      target: { col: 20, row: 2 }, targetType: 'city',
    };
    expect(production(e).selectOffensiveUnitTypeForCiv(e.civilizations[0], city)).toBe('artillery');
    // No walls, no plan: the fastest killer wins.
    addCity(e, 'Open', 21, 2, 1, 6);
    (e.getPlayerStorage(0)!.turnData as Record<string, unknown>).offensivePlan = {
      target: { col: 21, row: 2 }, targetType: 'city',
    };
    expect(production(e).selectOffensiveUnitTypeForCiv(e.civilizations[0], city)).toBe('tank');
  });
});

describe('endgame research', () => {  const personality = { aggression: 7, expansion: 5, diplomacy: 5, science: 5, military: 7, economy: 5 };
  const state = (over: Record<string, unknown> = {}) => ({
    currentYear: 1950,
    roundNumber: 300,
    numCities: 4,
    numOwnCities: 4,
    totalPopulation: 20,
    numMilitaryUnits: 8,
    numOwnMilitaryUnits: 8,
    numOwnCivilianUnits: 2,
    averageEnemyStrength: 30,
    ownMilitaryStrength: 40,
    numTechnologies: 40,
    isAtWar: true,
    knownEnemyCities: 3,
    numEnemyCitiesKnown: 3,
    threatenedCitiesCount: 0,
    criticalThreatsCount: 0,
    hasLibrary: true,
    totalScience: 20,
    hasWaterAccess: true,
    ...over,
  });

  it('races Fission once Manhattan stands without it', () => {
    const hot = AIResearch.scoreTechnology('nuclear_fission', personality as never, 'military_expansion' as never, state({ nuclearRelevance: 3 }) as never);
    const cold = AIResearch.scoreTechnology('nuclear_fission', personality as never, 'military_expansion' as never, state({ nuclearRelevance: 0 }) as never);
    expect(hot.score).toBeGreaterThan(cold.score);
    expect(hot.reason).toContain('nuclear-endgame');
  });

  it('researches the Power chain root on the way to the tip', () => {
    const scored = AIResearch.scoreTechnology('nuclear_power', personality as never, 'military_expansion' as never, state({ nuclearRelevance: 2 }) as never);
    expect(scored.reason).toContain('nuclear-chain');
  });
});

describe('total-war gold spending', () => {
  it('rushes attackers on the anvil, not just defenders', async () => {
    const { default: GameEngine } = await import('@/game/engine/GameEngine');
    const engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 500,
    });
    const civ = engine.civilizations.find((c) => !c.isHuman) ?? engine.civilizations[1];
    const city = (engine.cities.find((c) => c.civilizationId === civ.id)
      ?? engine.foundCity(8, 8, civ.id, 'Anvil')) as unknown as {
        autoProduction?: boolean;
        currentProduction?: unknown;
        productionStored: number;
      };
    (city as { autoProduction?: boolean }).autoProduction = true;
    city.currentProduction = { type: 'unit', itemType: 'archer', name: 'Archer', cost: 30 } as never;
    city.productionStored = 0;
    civ.resources.gold = 500;
    // Total-war branch: the committed offensive waits for soldiers.
    (engine.getPlayerStorage(civ.id)!.turnData as Record<string, unknown>).strategyBranch = 'total_war';
    (engine.autoProduction as unknown as { evaluateGoldSpending: (id: number) => void }).evaluateGoldSpending(civ.id);
    // 30 shields × 2 gold = 60 spent, build completed.
    expect(city.productionStored).toBe(30);
    expect(civ.resources.gold).toBe(440);
  });
});

describe('staged endgame through real turns', () => {
  it('a staged superpower fires its warhead within 60 turns', async () => {
    const { makeEngine } = await import('../helpers/world');
    const world = await makeEngine({ mapType: 'AI_VS_AI_NAVAL', numberOfCivilizations: 2, seed: 4242 });
    const { engine } = world;
    await world.runTurns(2);
    const civ = engine.civilizations.find((c) => c.isAI && c.isAlive !== false)
      ?? engine.civilizations.find((c) => !c.isHuman);
    expect(civ).toBeDefined();
    const civId = civ!.id;
    const storage = engine.getPlayerStorage(civId);
    if (storage?.explored) storage.explored.fill(true);
    // Stage the atomic age: Fission known, Manhattan standing, year 1950.
    const techs = (civ as unknown as { technologies?: unknown }).technologies;
    if (Array.isArray(techs)) {
      for (const t of ['nuclear_fission', 'combustion']) if (!techs.includes(t)) techs.push(t);
    }
    (engine as unknown as { currentYear: number }).currentYear = 1950;
    const foe = engine.civilizations.find((c) => c.id !== civId && c.isAlive !== false)!;
    engine.diplomacyManager.declareWar(civId, foe.id);
    // Nuke + launch sub at our coast nearest the biggest enemy city.
    const targets = engine.cities
      .filter((c) => c.civilizationId === foe.id)
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    expect(targets.length).toBeGreaterThan(0);
    const target = targets[0];
    const grid = engine.squareGrid!;
    const ownCoastal = engine.cities.filter(
      (c) => c.civilizationId === civId && engine.findAdjacentOcean?.(c.col, c.row),
    );
    expect(ownCoastal.length).toBeGreaterThan(0);
    ownCoastal.sort(
      (a, b) => grid.squareDistance(a.col, a.row, target.col, target.row)
        - grid.squareDistance(b.col, b.row, target.col, target.row),
    );
    const base = ownCoastal[0];
    if (!base.buildings.includes('manhattan_project')) base.buildings.push('manhattan_project');
    const water = engine.findAdjacentOcean!(base.col, base.row);
    world.spawnUnit({ id: `e2e-nuke-${civId}`, type: 'nuclear', civilizationId: civId, col: base.col, row: base.row });
    world.spawnUnit({ id: `e2e-sub-${civId}`, type: 'submarine', civilizationId: civId, col: water.col, row: water.row });
    // Capture the strike event (chain the engine's own handler).
    let struck = 0;
    const prevOSC = engine.onStateChange as ((...args: never[]) => unknown) | null;
    engine.onStateChange = ((...args: never[]) => {
      if (args[0] === 'NUCLEAR_STRIKE') struck++;
      return typeof prevOSC === 'function' ? prevOSC(...args) : undefined;
    }) as typeof engine.onStateChange;
    (engine as unknown as { isPaused: boolean }).isPaused = false;
    const activeCivs = engine.civilizations.filter((c) => c.isAlive !== false);
    for (let i = 0; i < 60 && struck === 0; i++) {
      if (engine.isGameOver) break;
      for (const c of activeCivs) {
        engine.turnManager.startTurn(c.id);
        (engine as unknown as { activePlayer: number }).activePlayer = c.id;
        if (c.isAI) {
          try {
            await engine.processAITurn(c.id);
          } catch { /* state shows the damage */ }
        }
        if (engine.turnManager.getPhase() && engine.turnManager.getPhase() !== 'END') {
          await engine.turnManager.nextPhase();
          await engine.turnManager.nextPhase();
          await engine.turnManager.nextPhase();
        }
      }
    }
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    expect(struck).toBeGreaterThan(0);
  }, 300000);
});
