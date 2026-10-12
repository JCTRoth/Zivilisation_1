/**
 * Ad-hoc research chooser probe (NOT a test — vitest.config.js excludes `tmp*`).
 *   npx vitest run --config vitest.diag.config.ts tests/ai/tmpChooserProbe.test.ts
 *
 * What does AIResearch.selectResearch actually pick for a civ that has two
 * cities, no trade routes and the currency prerequisite? Prints the ranking.
 */
import { describe, it, expect } from 'vitest';
import { AIResearch } from '@/game/engine/AI/AIResearch';

const out = console.info.bind(console);
const personality = { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 };

describe('research chooser', () => {
  it('ranks the trade line for a route-less civ', () => {
    for (const strategy of ['balanced_growth', 'military_expansion', 'science_focus'] as const) {
      const state = {
        currentYear: -2500, roundNumber: 60, numCities: 2, numEnemyCitiesKnown: 1,
        isAtWar: false, hasLibrary: false, totalScience: 6,
        caravanRelevance: 3,
      } as never;
      const scored = (AIResearch as unknown as {
        getAvailableTechnologies: (civ: unknown) => string[];
        scoreTechnology: (id: string, p: unknown, s: unknown, g: unknown) => { score: number; reason: string };
      });
      const civ = {
        id: 0, technologies: ['pottery', 'bronze_working', 'alphabet', 'currency', 'writing', 'masonry'],
        personality, productionProfile: strategy,
      } as never;
      const available = scored.getAvailableTechnologies(civ);
      const ranked = available
        .map((id) => ({ id, ...scored.scoreTechnology(id, personality, strategy, state) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      out(`\n[${strategy}] available=${available.length}`);
      for (const r of ranked) out(`   ${String(r.score.toFixed(1)).padStart(6)}  ${r.id.padEnd(22)} ${r.reason}`);
      out(`   -> picks ${ranked[0]?.id}`);
      const choice = AIResearch.selectResearch(civ, strategy, state);
      out(`   -> selectResearch = ${choice}`);
    }
    expect(true).toBe(true);
  });
});
