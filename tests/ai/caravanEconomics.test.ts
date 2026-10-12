/**
 * The Caravan line's research priority and pricing.
 *
 * A profiled 1,000-round AI game delivered ZERO trade routes: every city sat
 * three routes short of capacity while `currency`/`trade` were never researched,
 * because nothing in the scoring wanted them. `caravanRelevanceForCiv` is the
 * hook that fixes that, and these tests pin both the hook and the payout it
 * exists to make reachable.
 */
import { describe, it, expect } from 'vitest';
import {
  caravanRelevanceForCiv,
  MAX_TRADE_ROUTES_PER_CITY,
} from '@/game/engine/AI/CaravanEconomics';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import { MAX_TRADE_ROUTES } from '@/game/engine/GameEngine';

const city = (population: number, tradeRoutes: number, civilizationId = 0) => ({
  population, tradeRoutes: Array.from({ length: tradeRoutes }), civilizationId,
});

describe('caravanRelevanceForCiv', () => {
  it('wants nothing when the civ has no cities', () => {
    expect(caravanRelevanceForCiv([], 0, true)).toBe(0);
  });

  it('wants nothing when every city is too small to host a route', () => {
    // Pop-1 cities do not count — a route from them pays nothing.
    const cities = [city(1, 0, 0), city(1, 0, 1)];
    expect(caravanRelevanceForCiv(cities, 0, true)).toBe(0);
  });

  it('wants nothing when there is nobody else to trade with', () => {
    const cities = [city(6, 0, 0)];
    expect(caravanRelevanceForCiv(cities, 0, true)).toBe(0);
  });

  it('is highest for a route-less single-city civ at peace', () => {
    // ONE city is enough: its routes are foreign ones, which is exactly the
    // valuable kind and the reason to research the tech.
    const cities = [city(4, 0, 0), city(4, 0, 1)];
    expect(caravanRelevanceForCiv(cities, 0, true)).toBe(3);
  });

  it('still wants the tech at war — domestic routes remain legal', () => {
    const cities = [city(4, 0, 0), city(4, 0, 0), city(4, 0, 1)];
    expect(caravanRelevanceForCiv(cities, 0, false)).toBeGreaterThan(0);
  });

  it('wants nothing when every city already holds a full set of routes', () => {
    const full = MAX_TRADE_ROUTES_PER_CITY;
    const cities = [city(6, full, 0), city(6, 0, 1)];
    expect(caravanRelevanceForCiv(cities, 0, true)).toBe(0);
  });

  it('ignores other civilizations entirely', () => {
    const cities = [city(4, 0, 0), city(4, 0, 1), city(4, 0, 1)];
    expect(caravanRelevanceForCiv(cities, 0, true)).toBe(3);
  });
});

describe('AIResearch caravan priority', () => {
  const personality = { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 };
  const state = (caravanRelevance: number) => ({
    currentYear: -2500, roundNumber: 40, numCities: 4, numEnemyCitiesKnown: 1,
    isAtWar: false, hasLibrary: false, totalScience: 8, caravanRelevance,
  }) as never;

  it('pushes the trade tech when the empire is route-less', () => {
    const scored = AIResearch.scoreTechnology('trade', personality, 'balanced_growth', state(3));
    expect(scored.reason).toMatch(/caravan-relevance/);
  });

  it('pushes its prerequisite too, or the civ stalls one tech short', () => {
    const scored = AIResearch.scoreTechnology('currency', personality, 'balanced_growth', state(3));
    expect(scored.reason).toMatch(/caravan-relevance/);
  });

  it('does not push it when the routes are already built', () => {
    const without = AIResearch.scoreTechnology('trade', personality, 'balanced_growth', state(0));
    const withPush = AIResearch.scoreTechnology('trade', personality, 'balanced_growth', state(3));
    expect(withPush.score).toBeGreaterThan(without.score);
  });
});

describe('trade route capacity', () => {
  it('the hook and the engine agree on the cap', () => {
    expect(MAX_TRADE_ROUTES_PER_CITY).toBe(MAX_TRADE_ROUTES);
  });

  it('uses Civ1 three slots per city', () => {
    expect(MAX_TRADE_ROUTES).toBe(3);
  });
});
