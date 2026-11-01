/**
 * Boot check for every map type the setup screen offers (step 2).
 *
 * The setup dropdown (GameSetupModal MAP_TYPE_CATEGORIES) and the engine's
 * per-type branches must agree: a type the UI offers has to initialize with
 * sane starting conditions AND survive a few rounds. This test is the sync
 * point — adding a map type to the setup list means adding it here.
 */
import { describe, it, expect } from 'vitest';
import { makeEngine } from './helpers/world';
import { UNIT_PROPS } from '@/utils/Constants';

/** Exactly the types in GameSetupModal's MAP_TYPE_CATEGORIES, in order. */
const OFFERED_MAP_TYPES = [
  // Standard
  'NORMAL_SKIRMISH',
  'EARTH',
  // Close-up / Duels
  'CLOSEUP_1V1',
  'CLOSEUP_BEATUP',
  'NAVAL_CLOSEUP',
  // Scenarios
  'NO_SETTLERS',
  'MANY_CITIES',
  'TECH_LEVEL_10',
  'ALL_UNITS',
  // Naval campaigns
  'AEGEAN_CAMPAIGN',
  // AI vs AI
  'AI_VS_AI',
  'AI_VS_AI_SMALL',
  'AI_VS_AI_NAVAL',
];

/** Sizes the engine pins per type (GameEngine.initialize). */
const PINNED_SIZES: Record<string, { width: number; height: number }> = {
  CLOSEUP_1V1: { width: 20, height: 20 },
  CLOSEUP_BEATUP: { width: 20, height: 20 },
  NAVAL_CLOSEUP: { width: 20, height: 20 },
  EARTH: { width: 180, height: 90 },
  AI_VS_AI: { width: 40, height: 40 },
  AI_VS_AI_SMALL: { width: 16, height: 26 },
  AI_VS_AI_NAVAL: { width: 96, height: 60 },
  AEGEAN_CAMPAIGN: { width: 96, height: 60 },
};

describe('every offered map type boots', () => {
  for (const mapType of OFFERED_MAP_TYPES) {
    it(`${mapType} initializes with sane starting conditions and survives two rounds`, async () => {
      const world = await makeEngine({ mapType, numberOfCivilizations: 3, seed: 424 });
      const e = world.engine;

      // Map: present, complete, and the size the engine promises.
      expect(e.map, `${mapType} produced no map`).toBeTruthy();
      expect(e.map!.tiles.length).toBe(e.map!.width * e.map!.height);
      const pinned = PINNED_SIZES[mapType];
      if (pinned) {
        expect(e.map!.width).toBe(pinned.width);
        expect(e.map!.height).toBe(pinned.height);
      }

      // Every civilization got a start: units and/or cities.
      expect(e.civilizations.length).toBe(3);
      for (const civ of e.civilizations) {
        const units = e.units.filter((u) => u.civilizationId === civ.id && !u.isDefeated);
        const cities = e.cities.filter((c) => c.civilizationId === civ.id);
        expect(units.length + cities.length, `${civ.name} started with nothing on ${mapType}`)
          .toBeGreaterThan(0);

        switch (mapType) {
          case 'MANY_CITIES':
            expect(cities.length, `${civ.name} should open with 4 cities`).toBe(4);
            break;
          case 'NO_SETTLERS':
            expect(units.some((u) => u.type === 'settler'), 'no settlers allowed').toBe(false);
            expect(cities.length, 'No Settlers still starts with one city').toBeGreaterThanOrEqual(1);
            break;
          case 'TECH_LEVEL_10':
            expect(civ.technologies.length, 'all techs granted').toBeGreaterThan(40);
            expect(civ.technologies, 'the victory marker must not be granted')
              .not.toContain('moonshot');
            break;
          case 'ALL_UNITS':
            expect(units.length, 'showcase spreads many units').toBeGreaterThan(20);
            break;
          case 'NAVAL_CLOSEUP':
            expect(units.length, 'water world starts with a fleet').toBeGreaterThanOrEqual(2);
            expect(units.every((u) => UNIT_PROPS[u.type]?.naval === true), 'water world starts naval only')
              .toBe(true);
            break;
          default:
            break;
        }
      }

      // The type must also survive play, not just initialization.
      await world.runTurns(2);
      expect(e.isGameOver, `${mapType} ended during the opening rounds`).toBe(false);
    }, 120000);
  }
});
