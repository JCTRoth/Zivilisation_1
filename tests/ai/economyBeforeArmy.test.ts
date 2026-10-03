/**
 * Economics before the army.
 *
 * `ABSOLUTE_MIN_GOLD` (8) is the level the treasury is reset to when a civ is
 * forced to disband, so a civ sitting on it has money and NO income. The old
 * production chain failed that civ twice over:
 *
 *  1. `canAffordAnotherUnit` demands a projected surplus of at least +1 gold, so
 *     the settler branch was skipped and the city fell through to the army step
 *     and queued another military unit — upkeep it cannot earn. The profiled run
 *     quoted in `AutoProduction` built 2,301 riflemen and disbanded 2,302.
 *  2. Nothing in the chain said "fix the income first", so a civ with a road
 *     half-built and a full army queue never chose the road.
 *
 * The settler is the one production that escapes the spiral: it is paid in
 * shields rather than gold, and the road it lays is permanent +trade. These
 * tests pin that reaching the reserve buys a settler and vetoes the army until
 * those roads have paid.
 */
import { describe, it, expect, vi } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { ABSOLUTE_MIN_GOLD } from '@/game/engine/EconomicManager';

const RESERVE = ABSOLUTE_MIN_GOLD;

/** Units that cost (almost) nothing in upkeep and are not soldiers. */
const CIVILIANS = ['settler', 'scout', 'diplomat', 'caravan'];

interface HarnessOptions {
  /** Treasury in gold. */
  gold: number;
  /** Projected per-turn surplus — what "can afford a unit" means. */
  net: number;
  /** Whether roads/irrigation are still waiting. */
  wantsWorks?: boolean;
  settlerCount?: number;
}

function makeEngine(opts: HarnessOptions) {
  const { gold, net, wantsWorks = true, settlerCount = 0 } = opts;

  const city = {
    id: 'city-1', name: 'City 1', civilizationId: 1, col: 1, row: 1, population: 4,
    // Already holding every building worth having, so the building branches of
    // the chain are satisfied and it reaches the army step the rule must veto.
    buildings: ['granary', 'temple', 'marketplace', 'courthouse', 'colosseum', 'library', 'aqueduct'],
    currentProduction: null, autoProduction: true,
    yields: { food: 4, production: 3, trade: 4 },
  };

  const units: unknown[] = [
    { id: 'def', type: 'warrior', civilizationId: 1, col: 1, row: 1, attack: 1, defense: 1 },
  ];
  for (let i = 0; i < settlerCount; i++) {
    units.push({ id: `settler_${i}`, type: 'settler', civilizationId: 1, col: 8, row: 8 });
  }

  // `ensureProductionQueue` can call this several times per production pick, so
  // the assertions look at every item the city was offered, not just the last.
  const produced: { type: string; itemType?: string }[] = [];
  const productionManager = {
    setCityProduction: vi.fn().mockImplementation((_id: string, item: { type: string; itemType?: string }) => {
      produced.push(item);
      return { success: true };
    }),
  };

  const engine = {
    cities: [city],
    units,
    civilizations: [
      null,
      {
        id: 1, name: 'TestCiv',
        technologies: ['warrior_code', 'pottery', 'masonry'],
        productionProfile: 'balanced_growth',
        warWith: new Set(),
        taxRate: 50, scienceRate: 50, luxuryRate: 0,
        resources: { gold, food: 0, production: 0, trade: 0, science: 0 },
      },
    ],
    productionManager,
    getPlayerStorage: () => ({ turnData: {} }),
    squareGrid: { squareDistance: () => 1, isValidSquare: () => true },
    roundManager: { getRoundNumber: () => 10 },
    currentYear: -1000,
    gameSettings: { difficulty: 'PRINCE', mapType: 'AI_VS_AI' },
    getCityAt: () => null,
    getUnitAt: () => null,
    getTileAt: () => null,
    map: { width: 20, height: 20, tiles: [] },
    economicManager: {
      AI_MIN_GOLD_RESERVE: RESERVE,
      // `canAffordAnotherUnit` reads exactly this.
      previewEconomy: () => ({ net }),
      cityFoodBalance: () => ({ surplus: 4, turnsUntilStarvation: -1 }),
      cityHappiness: () => ({ disorder: false, unhappiness: 0, happiness: 4, luxury: 0, entertainers: 0 }),
      cityOutputs: () => ({ food: 4, production: 3, trade: 4, tax: 2, science: 2, luxury: 0 }),
      totalUpkeep: () => 10,
      sustainableUnits: () => 8,
      getRates: () => ({ tax: 50, science: 50, luxury: 0 }),
      buildingUpkeep: () => 0,
      maxTaxIncome: () => 10,
      totalIncome: () => 10,
    },
    aiEconomicManager: {
      sustainableUnits: () => 8,
      isUnderEconomicPressure: () => net <= 0,
    },
    aiManager: { wantsPublicWorks: () => wantsWorks },
  };

  new AutoProduction(engine as never).setAutoProduction('city-1');
  return produced;
}

/** Anything the city was told to build that is not a civilian. */
const soldiers = (produced: { type: string; itemType?: string }[]) =>
  produced.filter(item => item.type === 'unit' && !CIVILIANS.includes(item.itemType ?? ''));

describe('economics before the army', () => {
  it('builds a settler once the reserve is reached and there is road work', () => {
    const produced = makeEngine({ gold: RESERVE, net: 0, wantsWorks: true });
    expect(produced.some(item => item.itemType === 'settler')).toBe(true);
  });

  it('vetoes the army while the civ cannot pay for it', () => {
    // Settler target already met, no road work: nothing but the army is left to
    // produce, and the army is exactly what this civ must not buy.
    const produced = makeEngine({ gold: RESERVE, net: 0, wantsWorks: false, settlerCount: 3 });
    expect(soldiers(produced)).toEqual([]);
  });

  it('still produces for a civ that can pay its own way', () => {
    // Same city, same everything, but the roads turned the surplus positive. If
    // the veto fired here it would be stopping production outright rather than
    // reordering it.
    const produced = makeEngine({ gold: 400, net: 12, wantsWorks: false, settlerCount: 3 });
    expect(produced.length).toBeGreaterThan(0);
  });

  it('leaves a civ below the reserve alone — it could not fund a settler anyway', () => {
    const produced = makeEngine({ gold: RESERVE - 1, net: 0, wantsWorks: true });
    expect(produced.some(item => item.itemType === 'settler')).toBe(false);
  });

  it('does not run away with settlers — the corps target still bounds it', () => {
    const produced = makeEngine({ gold: RESERVE, net: 0, wantsWorks: true, settlerCount: 6 });
    expect(produced.some(item => item.itemType === 'settler')).toBe(false);
  });
});