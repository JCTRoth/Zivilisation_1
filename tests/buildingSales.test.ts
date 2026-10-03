/**
 * The AI has to be able to sell its own buildings.
 *
 * The bug this pins: `sellBuilding` resolved the civ from `activePlayer` and
 * then refused any city not owned by it, so an AI civ could only liquidate a
 * building while it happened to be the active player — never in a human game,
 * and one civ at a time in an AI game. The refund was credited to
 * `activePlayer` as well, so a sale that did get through would have paid the
 * wrong civilisation.
 *
 * The symptom was an empire sitting on zero gold with a dozen buildings per city
 * and no army: its whole maintenance bill unpaid, and every attempted sale
 * returning "City not found or not owned" so the audit silently did nothing.
 */
import { describe, expect, it } from 'vitest';
import { makeGridEngine } from './helpers/world';
import type { City, Civilization } from '../types/game';

const G = 'grassland';

/**
 * A human on civ 0 (the active player) and an AI on civ 1, each with a city.
 * The AI's city holds one bank so there is something to sell.
 */
function world() {
  const engine = makeGridEngine([
    [G, G, G, G, G],
    [G, G, G, G, G],
    [G, G, G, G, G],
    [G, G, G, G, G],
    [G, G, G, G, G],
  ]);
  const makeCity = (id: string, civId: number, col: number, row: number, buildings: string[]): City =>
    ({
      id, name: id, civilizationId: civId, col, row, population: 4,
      buildings, specialists: [], workingTiles: new Set([`${col},${row}`]),
      userAssignedTiles: new Set<string>(),
      yields: { food: 10, production: 10, trade: 10 },
    }) as unknown as City;

  engine.cities = [makeCity('human-city', 0, 1, 1, ['temple']), makeCity('ai-city', 1, 3, 3, ['bank'])];
  engine.activePlayer = 0;

  const human = engine.civilizations[0] as Civilization;
  const ai = engine.civilizations[1] as Civilization;
  human.isHuman = true;
  ai.isHuman = false;
  human.resources.gold = 0;
  ai.resources.gold = 0;
  return { engine, human, ai };
}

describe('an AI civ can sell its own buildings', () => {
  it('sells a building in its own city while another civ is active', () => {
    const { engine } = world();
    expect(engine.activePlayer).toBe(0); // the human is active; the AI is not

    const result = engine.sellBuilding('ai-city', 'bank', { force: true });

    expect(result.success, result.reason).toBe(true);
    expect(result.refund).toBe(60); // 50 % of a bank's 120
    expect(engine.cities[1].buildings).not.toContain('bank');
  });

  it('credits the refund to the civ that owns the city, not the active player', () => {
    const { engine, human, ai } = world();
    engine.sellBuilding('ai-city', 'bank', { force: true });

    expect(ai.resources.gold).toBe(60);
    // The single most important assertion in this file: the human's treasury
    // must be untouched by an AI's liquidation.
    expect(human.resources.gold).toBe(0);
  });

  it('works for every AI civ in an AI-vs-AI game, not just the active one', () => {
    const { engine } = world();
    // Both civs are AI now, and civ 1 holds the active seat.
    engine.activePlayer = 1; // now civ 1 is active and civ 0 is not
    (engine.civilizations[0] as Civilization).isHuman = false;
    engine.cities[0].buildings = ['temple'];

    const result = engine.sellBuilding('human-city', 'temple', { force: true });

    expect(result.success, result.reason).toBe(true);
    expect(engine.cities[0].buildings).not.toContain('temple');
    expect((engine.civilizations[0] as Civilization).resources.gold).toBe(20);
    expect((engine.civilizations[1] as Civilization).resources.gold).toBe(0);
  });
});

describe('selling without force stays a player action', () => {
  it('lets a human sell their own active city', () => {
    const { engine, human } = world();
    const result = engine.sellBuilding('human-city', 'temple');
    expect(result.success, result.reason).toBe(true);
    expect(human.resources.gold).toBe(20);
  });

  it('refuses to sell a city belonging to someone else', () => {
    const { engine } = world();
    const result = engine.sellBuilding('ai-city', 'bank');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/not a human player/i);
  });

  it('refuses a non-human sale that forgot `force`', () => {
    const { engine } = world();
    engine.activePlayer = 1; // an AI is active, but it still must ask properly
    (engine.civilizations[1] as Civilization).isHuman = false;
    const result = engine.sellBuilding('ai-city', 'bank');
    expect(result.success).toBe(false);
  });
});

describe('the engine own sale guards still hold', () => {
  it('allows only one building sold per city per turn', () => {
    const { engine } = world();
    engine.cities[1].buildings = ['bank', 'courthouse'];

    expect(engine.sellBuilding('ai-city', 'bank', { force: true }).success).toBe(true);
    const second = engine.sellBuilding('ai-city', 'courthouse', { force: true });
    expect(second.success).toBe(false);
    expect(second.reason).toMatch(/already sold/i);
  });

  it('will not sell a wonder', () => {
    const { engine } = world();
    engine.cities[1].buildings = ['pyramids'];
    const result = engine.sellBuilding('ai-city', 'pyramids', { force: true });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/wonder/i);
  });

  it('reports a building the city does not have', () => {
    const { engine } = world();
    const result = engine.sellBuilding('ai-city', 'aqueduct', { force: true });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/not found in city/i);
  });
});
