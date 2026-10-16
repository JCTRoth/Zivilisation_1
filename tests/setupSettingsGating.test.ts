/**
 * The setup dialog shows a setting only when it changes the world.
 *
 * A slider that does nothing is a promise the engine does not keep. The engine
 * has FOUR world generators and only one reads the land-shaping sliders:
 *
 *   generate()            the 8-stage procedural one — landMass, temperature,
 *                         climate and age all shape it (MapGenerator stages
 *                         1–6). Used by NORMAL_SKIRMISH, CLOSEUP_1V1,
 *                         CLOSEUP_BEATUP, NO_SETTLERS, MANY_CITIES,
 *                         TECH_LEVEL_10, ALL_UNITS, AI_VS_AI, AI_VS_AI_SMALL.
 *   generateWaterOnly()   NAVAL_CLOSEUP's all-ocean world — every slider inert.
 *   generateFromStatic()  the hand-authored maps (EARTH, AI_VS_AI_NAVAL,
 *                         AEGEAN_CAMPAIGN) — terrain comes from a JSON
 *                         file; only river COUNT varies.
 *
 * Dev Mode is the same story: AI-vs-AI forces it on (`isAutoScenario`), so the
 * checkbox is a switch that cannot be switched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import GameEngine from '@/game/engine/GameEngine';
import { useSeededRandom } from './helpers/world';

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'components', 'ui', 'GameSetupModal.tsx'), 'utf8');

/** The map types that do NOT read the land-shaping sliders, per the engine. */
const FIXED = ['EARTH', 'NAVAL_CLOSEUP', 'AI_VS_AI_NAVAL', 'AEGEAN_CAMPAIGN'];

/**
 * The maps whose world IS shaped by the sliders — i.e. every selectable map
 * type minus the four fixed ones. Hardcoded here on purpose: if the dialog ever
 * adds a map type and forgets it in this list, `everySelectableMapIsClassified`
 * below fails and the omission is deliberate.
 */
const SELECTABLE = [
  'NORMAL_SKIRMISH', 'EARTH', 'CLOSEUP_1V1', 'CLOSEUP_BEATUP', 'NAVAL_CLOSEUP',
  'NO_SETTLERS', 'MANY_CITIES', 'TECH_LEVEL_10', 'ALL_UNITS', 'AI_VS_AI',
  'AI_VS_AI_SMALL', 'AI_VS_AI_NAVAL', 'AEGEAN_CAMPAIGN',
];

describe('the land-shaping sliders are gated by the engine, not by memory', () => {
  it('the dialog gates them on one shared predicate', () => {
    // One predicate, used for both the sliders and the summary rows: if these
    // two call sites ever disagree the player sees a slider in one place and a
    // dead row in the other.
    expect(SOURCE).toContain('worldShapingSettingsHaveEffect(mapType)');
    expect(SOURCE).toContain('!worldShapingSettingsHaveEffect(mapType)');
    // And the predicate itself reads the fixed-map set, not an inline list.
    expect(SOURCE).toContain('return !FIXED_MAP_TYPES.has(mapType);');
  });

  it('the dialog no longer special-cases NAVAL_CLOSEUP alone', () => {
    // The old guard hid the sliders for exactly one of the four inert maps, so
    // EARTH and both archipelago scenarios offered world sliders that did
    // nothing but change how many rivers got drawn.
    expect(SOURCE).not.toContain("mapType !== 'NAVAL_CLOSEUP'");
    expect(SOURCE).not.toContain('mapType !== "NAVAL_CLOSEUP"');
  });

  it('the engine and the dialog agree on which maps are fixed', () => {
    // The dialog's set is a copy of the engine's; if the engine ever grows a
    // static map this catches the drift instead of the player noticing.
    const dialogSet = SOURCE.slice(SOURCE.indexOf('FIXED_MAP_TYPES:'), SOURCE.indexOf('};', SOURCE.indexOf('FIXED_MAP_TYPES:')));
    for (const m of FIXED) expect(dialogSet).toContain(m);
  });

  it('every selectable map is classified by the predicate', () => {
    const start = SOURCE.indexOf('MAP_TYPE_CATEGORIES');
    const end = SOURCE.indexOf('];', start);
    const block = SOURCE.slice(start, end);
    const found = new Set<string>();
    for (const m of block.matchAll(/types: \[([^\]]*)\]/g)) {
      for (const id of m[1].matchAll(/'([A-Z0-9_]+)'/g)) found.add(id[1]);
    }
    for (const m of SELECTABLE) expect(found, `${m} missing from the dropdown`).toContain(m);
    for (const m of found) expect(SELECTABLE, `${m} not classified`).toContain(m);
  });
});

describe('the fixed maps really do ignore the sliders', () => {
  /** Generate the same map twice with opposite slider values and compare. */
  const terrainAt = (mapType: string): string => {
    useSeededRandom(4242);
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    e.initialize({
      numberOfCivilizations: 2, mapType, devMode: false, startingGold: 50,
      mapSeed: 4242, landMass: 0, temperature: 0, climate: 0, age: 0,
    });
    return (e.map.tiles as Array<{ type?: string }>).map((t) => t.type ?? '').join(',');
  };

  it('NAVAL_CLOSEUP: the sliders cannot change an all-ocean world', () => {
    const cold = terrainAt('NAVAL_CLOSEUP');
    useSeededRandom(4242);
    const warm = new GameEngine(null);
    (warm as any).sleep = () => Promise.resolve();
    warm.initialize({
      numberOfCivilizations: 2, mapType: 'NAVAL_CLOSEUP', devMode: false, startingGold: 50,
      mapSeed: 4242, landMass: 2, temperature: 2, climate: 2, age: 2,
    });
    const warmTerrain = (warm.map.tiles as Array<{ type?: string }>).map((t) => t.type ?? '').join(',');
    expect(warmTerrain).toBe(cold);
    // …and it really is all water.
    expect(cold.split(',').every((t) => t !== 'grassland')).toBe(true);
  });
});

describe('Dev Mode is gated too', () => {
  it('the dialog hides the checkbox for auto scenarios', () => {
    expect(SOURCE).toContain('devModeSettingHasEffect(mapType)');
    expect(SOURCE).toContain('return !isAutoScenario(mapType);');
  });
});
