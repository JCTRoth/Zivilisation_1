/**
 * Regression tests for defects found while auditing for silent breakage.
 *
 * Each one is a bug that produced NO failing test at the time:
 *
 *  1. `civ.warWith` was read by six live systems but only ever written by the
 *     dead legacy Civilization class, so the AI never saw itself as at war:
 *     no mobilisation, no wartime queue reconsiderations, no military research
 *     boost, and the score's peace-years bonus never reset.
 *  2. Science earned during the opening rounds was overwritten every turn,
 *     because the research step does nothing while no technology is selected.
 *  3. `ProductionManager` answers `insufficient_gold` while the UI text map
 *     only knew `not_enough_gold`, so the friendly sentence never appeared.
 *  4. A ferry's cargo was only ever removed through a direct call to the
 *     private `destroyCargoOf`; no test killed a ferry in real combat.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { productionFailureText } from '@/utils/ProductionUtils';
import { RESEARCH_UNLOCK_ROUND } from '@/data/GameConstants';
import { forceRandom, makeEngine, makeGridEngine, useSeededRandom, world } from './helpers/world';

const G = 'grassland';

function bare(): GameEngine {
  const row = [G, G, G, G, G];
  return makeGridEngine([row, [...row], [...row], [...row], [...row]]);
}

describe('Fix: "at war" is read from the diplomacy manager, not a dead field', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a declared war and a peace', async () => {
    const { engine } = await makeEngine({ seed: 12 });
    const a = engine.civilizations[0];
    const b = engine.civilizations[1];

    expect(engine.isCivAtWar(a.id)).toBe(false);
    engine.diplomacyManager.declareWar(a.id, b.id);
    expect(engine.isCivAtWar(a.id)).toBe(true);
    expect(engine.isCivAtWar(b.id)).toBe(true);

    engine.diplomacyManager.makePeace?.(a.id, b.id);
    expect(engine.isCivAtWar(a.id)).toBe(false);
  });

  it('resets the peace streak when war is declared (score bonus)', async () => {
    const { engine } = await makeEngine({ seed: 13 });
    const a = engine.civilizations[0];
    const b = engine.civilizations[1];
    a.peaceTurns = 7;

    engine.diplomacyManager.declareWar(a.id, b.id);
    engine.victoryManager.evaluateEndOfTurn();

    expect(a.peaceTurns).toBe(0);
  });

  it('falls back to warWith only when there is no diplomacy manager', async () => {
    const { engine } = await makeEngine({ seed: 14 });
    // The diplomacy manager is the source of truth while it exists, even if a
    // civ carries a stale `warWith` set.
    engine.civilizations[0].warWith = new Set([1]);
    expect(engine.isCivAtWar(engine.civilizations[0].id)).toBe(false);

    // With no diplomacy manager the legacy field is the only thing left.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).diplomacyManager = null;
    expect(engine.isCivAtWar(engine.civilizations[0].id)).toBe(true);
  });

  it('the AI sees itself at war (military research / mobilisation reacts)', async () => {
    useSeededRandom(3);
    const { engine } = await makeEngine({ seed: 77, mapType: 'AI_VS_AI' });
    const a = engine.civilizations[0];
    const b = engine.civilizations[1];

    // Before: isCivAtWar always false, so `buildGameState.isAtWar` never fired.
    expect(engine.isCivAtWar(a.id)).toBe(false);
    engine.diplomacyManager.declareWar(a.id, b.id);
    expect(engine.isCivAtWar(a.id)).toBe(true);
  });
});

describe('Fix: opening-round science is banked, not discarded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('banks the science of the rounds before research is possible', () => {
    const engine = bare();
    const civ = engine.civilizations[0];
    civ.currentResearch = null;
    civ.taxRate = 0;
    civ.scienceRate = 100;
    civ.luxuryRate = 0;

    // A size-2 city working a real grassland tile earns science.
    const w = world(engine);
    const city = w.settle('Bank', 2, 2, civ.id, 2);
    city.workingTiles = new Set(['2,2', '1,2', '2,3']);
    engine.economicManager.recomputeCityYields(city as never);

    engine.economicManager.processTurn(civ);

    expect(civ.resources.science ?? 0).toBeGreaterThan(0);
    // With no technology selected the beakers are kept on the civ, not lost.
    expect(civ.bankedScience ?? 0).toBe(civ.resources.science ?? 0);
  });

  it('does not bank while a technology is already being researched', () => {
    const engine = bare();
    const civ = engine.civilizations[0];
    civ.taxRate = 0;
    civ.scienceRate = 100;
    civ.luxuryRate = 0;
    civ.currentResearch = { id: 'pottery', name: 'Pottery' } as never;

    const w = world(engine);
    const city = w.settle('Busy', 2, 2, civ.id, 2);
    city.workingTiles = new Set(['2,2', '1,2', '2,3']);
    engine.economicManager.recomputeCityYields(city as never);

    engine.economicManager.processTurn(civ);

    expect(civ.resources.science ?? 0).toBeGreaterThan(0);
    expect(civ.bankedScience ?? 0).toBe(0);
  });

  it('spends the banked science the moment a technology is chosen', async () => {
    const { engine } = await makeEngine({ seed: 21 });
    const civ = engine.civilizations[0];
    civ.currentResearch = null;
    civ.bankedScience = 40;

    const pick = engine.availableResearchFor(civ.id)[0];
    expect(pick).toBeDefined();
    engine.setResearch(civ.id, pick!.id as never);

    expect(civ.bankedScience ?? 0).toBe(0);
    expect(civ.researchProgress ?? 0).toBeGreaterThanOrEqual(40);
  });

  it('an auto-selected technology also spends the bank', async () => {
    useSeededRandom(2);
    const { engine } = await makeEngine({ seed: 22 });
    const civ = engine.civilizations[0];
    civ.currentResearch = null;
    civ.bankedScience = 17;

    const picked = engine.autoSelectResearch(civ.id);
    expect(picked).toBeTruthy();
    expect(civ.bankedScience ?? 0).toBe(0);
    expect(civ.researchProgress ?? 0).toBeGreaterThanOrEqual(17);
  });

  it('the opening rounds really do have no research target', async () => {
    const { engine } = await makeEngine({ seed: 23 });
    engine.roundManager.restoreState({ roundNumber: 0 });
    expect(engine.isResearchUnlocked()).toBe(false);
    expect(engine.civilizations[0].currentResearch).toBeFalsy();
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    expect(engine.isResearchUnlocked()).toBe(true);
  });
});

describe('Fix: production failure reasons render as a sentence', () => {
  it('the code ProductionManager actually emits has text', () => {
    expect(productionFailureText('insufficient_gold')).toBe('there is not enough gold');
    // The older spelling stays supported.
    expect(productionFailureText('not_enough_gold')).toBe('there is not enough gold');
    expect(productionFailureText('already_purchased_this_turn'))
      .toBe('this city already bought something this turn');
    expect(productionFailureText('requires_tech_bronze_working'))
      .toBe('it requires the bronze working technology');
  });

  it('a rejected purchase is reported with the mapped reason', () => {
    const engine = bare();
    const w = world(engine);
    const civ = engine.civilizations[0];
    const city = w.settle('Broke', 2, 2, civ.id, 2);
    civ.resources.gold = 0;

    const result = engine.productionManager.purchaseCityProduction(
      city.id,
      { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 40 } as never,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('insufficient_gold');
    expect(productionFailureText(result.reason)).toBe('there is not enough gold');
  });
});

describe('Fix: a ferry that dies takes its cargo with it (real combat)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('killing the ferry in combat destroys the passenger', () => {
    const engine = bare();
    const w = world(engine);
    // A ferry and its passenger, with an enemy next to the ferry.
    const ferry = w.spawnUnit({ id: 'ferry-1', col: 2, row: 2, type: 'galley' });
    const passenger = w.spawnUnit({ id: 'cargo-1', col: 2, row: 2, type: 'warrior' });
    (passenger as unknown as { embarkedOn: string }).embarkedOn = ferry.id;
    (ferry as unknown as { cargoUnitId: string }).cargoUnitId = passenger.id;
    w.spawnUnit({ id: 'raider', col: 3, row: 2, civilizationId: 1, type: 'warrior', attack: 9 });

    // The attacker always wins the roll.
    forceRandom(0.01);
    const won = engine.combatUnit(
      engine.units.find((u) => u.id === 'raider') as never,
      engine.units.find((u) => u.id === 'ferry-1') as never,
    );
    expect(won).toBe(true);

    // Both the ferry and its cargo are out of the game.
    expect((ferry as unknown as { isDefeated: boolean }).isDefeated).toBe(true);
    expect((passenger as unknown as { isDefeated: boolean }).isDefeated).toBe(true);
    // A passenger can never act, even before the delayed removal fires.
    expect(engine.canUnitMoveTo('cargo-1', 1, 2)).toBe(false);
  });

  it('a ferry that survives keeps its cargo', () => {
    const engine = bare();
    const w = world(engine);
    const ferry = w.spawnUnit({ id: 'ferry-2', col: 2, row: 3, type: 'galley' });
    const passenger = w.spawnUnit({ id: 'cargo-2', col: 2, row: 3, type: 'warrior' });
    (passenger as unknown as { embarkedOn: string }).embarkedOn = ferry.id;
    (ferry as unknown as { cargoUnitId: string }).cargoUnitId = passenger.id;
    w.spawnUnit({ id: 'raider2', col: 3, row: 3, civilizationId: 1, type: 'warrior', attack: 1 });

    // The defender always wins: the ferry is wounded, not sunk.
    forceRandom(0.99);
    engine.combatUnit(
      engine.units.find((u) => u.id === 'raider2') as never,
      engine.units.find((u) => u.id === 'ferry-2') as never,
    );

    expect((ferry as unknown as { isDefeated: boolean }).isDefeated).not.toBe(true);
    expect((passenger as unknown as { isDefeated: boolean }).isDefeated).not.toBe(true);
  });
});
