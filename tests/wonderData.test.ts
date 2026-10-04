/**
 * Wonder data integrity — the data-driven contract of the 22 World Wonders.
 *
 * Every rule the spec states that can be checked WITHOUT a running game lives
 * here: exactly 22 wonders, unique ids, costs 200–600, zero maintenance,
 * every technology (required AND obsolescence) exists in the tech tree, effect
 * kinds are ones the effect engine understands, and the compatibility bridge
 * (`WONDER_PROPERTIES`) mirrors the data exactly.
 */
import { describe, it, expect } from 'vitest';
import {
  WONDERS,
  WONDER_IDS,
  getWonder,
  isWonderId,
  wondersForEra,
  computeWonderStatus,
  computeWonderStatuses,
  findWonderBuilders,
  findWonderOwner,
  isWonderObsolete,
} from '@/data/WonderData';
import { WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';

const TECH_IDS = new Set(TECHNOLOGIES_DATA.map((t) => t.id));

/** The effect kinds the WonderEffects engine switches on. */
const KNOWN_EFFECT_KINDS = new Set([
  'tradePerTradeSquare',
  'sciencePercent',
  'productionPercent',
  'productionFlat',
  'happiness',
  'unhappyToContent',
  'buildingHappinessMultiplier',
  'buildingScienceMultiplier',
  'navalMovement',
  'visionRange',
  'governmentAnarchyTurns',
  'autoUpgradeUnits',
  'enableSpaceship',
  'enableNuclear',
  'revealAllCities',
]);

describe('wonder data format', () => {
  it('defines exactly 22 unique wonders', () => {
    expect(WONDERS).toHaveLength(22);
    expect(new Set(WONDER_IDS).size).toBe(22);
    expect(WONDER_IDS).toHaveLength(22);
  });

  it('splits 7 / 7 / 8 across the three documentation eras', () => {
    expect(wondersForEra('antiquity')).toHaveLength(7);
    expect(wondersForEra('middle')).toHaveLength(7);
    expect(wondersForEra('industrial')).toHaveLength(8);
  });

  it('every wonder has a valid id, fixed cost 200–600 and no maintenance', () => {
    for (const w of WONDERS) {
      expect(w.id, 'id is snake_case').toMatch(/^[a-z][a-z0-9_]*$/);
      expect(w.cost, `${w.id} cost in range`).toBeGreaterThanOrEqual(200);
      expect(w.cost, `${w.id} cost in range`).toBeLessThanOrEqual(600);
      expect(w.maintenance, `${w.id} has no maintenance`).toBe(0);
      expect(isWonderId(w.id)).toBe(true);
    }
  });

  it('every required AND obsolescence technology exists in the tech tree', () => {
    for (const w of WONDERS) {
      expect(TECH_IDS.has(w.requiredTechnology), `${w.id} requires '${w.requiredTechnology}'`).toBe(true);
      if (w.obsoleteBy !== null) {
        expect(TECH_IDS.has(w.obsoleteBy), `${w.id} obsoletes by '${w.obsoleteBy}'`).toBe(true);
      }
    }
  });

  it('every wonder carries documentation and at least one typed effect', () => {
    for (const w of WONDERS) {
      expect(w.name.length, `${w.id} name`).toBeGreaterThan(0);
      expect(w.shortEffect.length, `${w.id} shortEffect`).toBeGreaterThan(0);
      expect(w.effectText.length, `${w.id} effectText`).toBeGreaterThan(0);
      expect(w.flavor.length, `${w.id} flavor`).toBeGreaterThan(0);
      expect(w.icon.length, `${w.id} icon`).toBeGreaterThan(0);
      expect(w.image, `${w.id} reserves an image slot`).toMatch(/^assets\/wonders\//);
      expect(Array.isArray(w.facts), `${w.id} facts array`).toBe(true);
      expect(w.effects.length, `${w.id} has >= 1 effect`).toBeGreaterThan(0);
      for (const effect of w.effects) {
        expect(KNOWN_EFFECT_KINDS.has(effect.kind), `${w.id} effect kind '${effect.kind}'`).toBe(true);
        expect(effect.scope, `${w.id} scope`).toBeTruthy();
      }
    }
  });

  it('never obsoletes more than half the wonders (some must be eternal)', () => {
    const eternal = WONDERS.filter((w) => w.obsoleteBy === null);
    expect(eternal.length).toBeGreaterThanOrEqual(10);
  });

  it('lookups work: getWonder / isWonderId', () => {
    expect(getWonder('pyramids')?.name).toBe('Pyramids');
    expect(getWonder('not_a_wonder')).toBeUndefined();
    expect(getWonder(null)).toBeUndefined();
    expect(isWonderId('great_wall')).toBe(false); // removed from the 22-wonder list
    expect(isWonderId('')).toBe(false);
  });
});

describe('WONDER_PROPERTIES compatibility bridge', () => {
  it('mirrors every wonder with matching name, cost, tech and 0 maintenance', () => {
    expect(Object.keys(WONDER_PROPERTIES).sort()).toEqual([...WONDER_IDS].sort());
    for (const w of WONDERS) {
      const props = WONDER_PROPERTIES[w.id];
      expect(props, w.id).toBeDefined();
      expect(props.name).toBe(w.name);
      expect(props.cost).toBe(w.cost);
      expect(props.maintenance).toBe(0);
      expect(props.requiredTechnology).toBe(w.requiredTechnology);
      expect(props.description).toBe(w.shortEffect);
      expect(props.effects?.wonder).toBe(true);
    }
  });
});

describe('wonder status classification (overview colours)', () => {
  const player = 0;
  const rival = 1;

  it('green: owned by the player', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: player, builderCivIds: [], playerHasTech: true })).toBe('owned');
  });

  it('red: owned by a rival', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: rival, builderCivIds: [], playerHasTech: true })).toBe('rival');
  });

  it('blue: the player alone is building it', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: null, builderCivIds: [player], playerHasTech: true })).toBe('building');
  });

  it('yellow: player AND a rival are building it', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: null, builderCivIds: [player, rival], playerHasTech: true })).toBe('contested');
  });

  it('red: only a rival is building it', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: null, builderCivIds: [rival], playerHasTech: true })).toBe('rival');
  });

  it('grey: locked behind an unresearched technology', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: null, builderCivIds: [], playerHasTech: false })).toBe('locked');
  });

  it('neutral: available — known tech, nobody building, nobody owning', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: null, builderCivIds: [], playerHasTech: true })).toBe('available');
  });

  it('ownership wins over a build race (rival owner stays red)', () => {
    expect(computeWonderStatus({ playerCivId: player, ownerCivId: rival, builderCivIds: [player], playerHasTech: true })).toBe('rival');
  });
});

describe('status context gathering (pure, store-compatible)', () => {
  const city = (id: string, civId: number, extra: Record<string, unknown> = {}) => ({
    id,
    civilizationId: civId,
    buildings: [],
    currentProduction: null,
    buildQueue: [],
    ...extra,
  });

  it('finds the owner and the builders from plain city objects', () => {
    const cities = [
      city('a', 0, { buildings: ['pyramids'] }),
      city('b', 1, { currentProduction: { type: 'building', itemType: 'lighthouse' } }),
      city('c', 1, { buildQueue: [{ type: 'building', itemType: 'lighthouse' }] }),
      city('d', 0, { currentProduction: { type: 'building', itemType: 'lighthouse' } }),
    ];
    expect(findWonderOwner('pyramids', cities)).toBe(0);
    expect(findWonderOwner('lighthouse', cities)).toBeNull();
    expect(findWonderBuilders('lighthouse', cities).sort()).toEqual([0, 1]);

    const statuses = computeWonderStatuses(
      cities,
      [
        { id: 0, technologies: ['map_making'] },
        { id: 1, technologies: [] },
      ],
      0,
    );
    expect(statuses.pyramids).toBe('owned');
    expect(statuses.lighthouse).toBe('contested'); // player + rival both building
    expect(statuses.great_library).toBe('locked'); // literacy unknown
    expect(statuses.anaximanders_map).toBe('available'); // map_making known, nobody started it
  });

  it('obsolescence is live the moment any civ has the tech', () => {
    const wonder = { technologies: [] as string[] };
    const rival = { technologies: [] as string[] };
    expect(isWonderObsolete('pyramids', [wonder, rival])).toBe(false);
    rival.technologies.push('communism');
    expect(isWonderObsolete('pyramids', [wonder, rival])).toBe(true);
    // Never-obsolete wonders stay active no matter what anyone researches.
    expect(isWonderObsolete('leonardos_workshop', [rival])).toBe(false);
  });
});
