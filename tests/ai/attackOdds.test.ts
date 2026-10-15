/**
 * AttackOdds — the AI's pre-attack calculation.
 *
 * Civ1 guide: "Always keep the odds in your head — do not attack without a
 * quick calculation." Covers:
 *  - the engagement estimate (a replay of the CombatSystem damage model,
 *    including terrain, fortification, in-city and fortress bonuses),
 *  - the solo odds floor and how friendly focus fire lowers it,
 *  - the siege field rule (catapults do not brawl in the open),
 *  - the soft-target exemptions (civilians, scouts).
 */
import { describe, expect, it } from 'vitest';
import {
  AI_ATTACK_FLOOR_CLAMP,
  AI_ATTACK_MIN_WIN_CHANCE,
  decideAiAttack,
  estimateEngagementWinChance,
} from '@/game/engine/AI/AttackOdds';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

const unit = (overrides: Record<string, unknown> = {}) => ({
  id: 'u',
  type: 'warrior',
  civilizationId: 0,
  attack: 1,
  defense: 1,
  health: 100,
  ...overrides,
});

const grassland = { type: TERRAIN_TYPES.GRASSLAND, terrain: TERRAIN_TYPES.GRASSLAND };
const forest = { type: TERRAIN_TYPES.FOREST, terrain: TERRAIN_TYPES.FOREST };

describe('estimateEngagementWinChance', () => {
  it('replays the engine advantage of the first striker in an even fight', () => {
    // Warrior vs warrior on open ground. The strengths are equal, so the
    // attacker's round win is an OVERRUN (lethal) while the defender needs
    // four won rounds — the engine gives the first striker ~2:3 odds here and
    // the estimate must see that.
    const chance = estimateEngagementWinChance(unit(), unit(), { defenderTile: grassland });
    expect(chance).toBeGreaterThan(0.6);
    expect(chance).toBeLessThan(0.7);
  });

  it('recognises a clear advantage (knight vs phalanx on open ground)', () => {
    const knight = unit({ type: 'knights', attack: 4, defense: 2 });
    const phalanx = unit({ type: 'phalanx', attack: 1, defense: 2 });
    const chance = estimateEngagementWinChance(knight, phalanx, { defenderTile: grassland });
    expect(chance).toBeGreaterThan(0.85);
  });

  it('follows the guide: a knight loses to a fortified musketeer in the woods', () => {
    // The guide's textbook case: defender 3 × forest 1.5 × fortification 1.5
    // = 6.75 against an attack of 4 — "do not attack without a calculation".
    const knight = unit({ type: 'knights', attack: 4, defense: 2 });
    const musketeer = unit({ type: 'musketeer', attack: 3, defense: 3, isFortified: true });
    const chance = estimateEngagementWinChance(knight, musketeer, { defenderTile: forest });
    expect(chance).toBeLessThan(0.3);
    expect(chance).toBeLessThan(AI_ATTACK_MIN_WIN_CHANCE);
  });

  it('drops when the attacker is wounded', () => {
    const healthy = estimateEngagementWinChance(
      unit({ type: 'chariot', attack: 4, defense: 2 }),
      unit({ type: 'phalanx', attack: 1, defense: 2 }),
      { defenderTile: grassland },
    );
    // Wounded attacker (25 HP) vs full-health defender: strength 1 vs 2.
    const wounded = estimateEngagementWinChance(
      unit({ type: 'chariot', attack: 4, defense: 2, health: 25 }),
      unit({ type: 'phalanx', attack: 1, defense: 2 }),
      { defenderTile: grassland },
    );
    expect(wounded).toBeLessThan(healthy);
    expect(wounded).toBeLessThan(0.5);
  });

  it('treats a defender that cannot fight back as a free kill', () => {
    const diplomat = unit({ type: 'diplomat', attack: 0, defense: 0 });
    expect(estimateEngagementWinChance(unit(), diplomat, { defenderTile: grassland })).toBe(1);
  });

  it('treats an attacker with no attack as unable to win', () => {
    const diplomat = unit({ type: 'diplomat', attack: 0, defense: 0 });
    expect(estimateEngagementWinChance(diplomat, unit(), { defenderTile: grassland })).toBe(0);
  });
});

describe('decideAiAttack: the odds floor', () => {
  it('allows an even fight', () => {
    const decision = decideAiAttack(unit(), unit(), { defenderTile: grassland });
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('even_or_better');
  });

  it('rejects a solo attack that is clearly against the odds', () => {
    // Warrior (1 attack) into a phalanx (2 defense) on open ground.
    const decision = decideAiAttack(unit(), unit({ type: 'phalanx', attack: 1, defense: 2 }), {
      defenderTile: grassland,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('low_odds');
    expect(decision.chance).toBeLessThan(AI_ATTACK_MIN_WIN_CHANCE);
  });

  it('lowers the floor as friendly units focus the same target', () => {
    const musketeer = unit({ type: 'musketeer', attack: 3, defense: 3, isFortified: true });
    const knight = unit({ type: 'knights', attack: 4, defense: 2 });
    const inCity = { ...grassland };

    const solo = decideAiAttack(knight, musketeer, { defenderTile: inCity, defenderInCity: true });
    expect(solo.allow).toBe(false);

    // Two more units pressing the same garrison turns a losing duel into a
    // siege the AI is willing to fight.
    const withSupport = decideAiAttack(knight, musketeer, {
      defenderTile: inCity,
      defenderInCity: true,
      support: 2,
    });
    expect(withSupport.allow).toBe(true);
    expect(withSupport.reason).toBe('focus_fire');
  });

  it('never drops the floor into pure suicide, however much support', () => {
    const knight = unit({ type: 'knights', attack: 4, defense: 2 });
    const forestGuard = unit({ type: 'musketeer', attack: 3, defense: 3, isFortified: true });
    const decision = decideAiAttack(knight, forestGuard, { defenderTile: forest, support: 99 });
    expect(decision.allow).toBe(false);
    expect(decision.chance).toBeLessThan(AI_ATTACK_FLOOR_CLAMP);
  });
});

describe('decideAiAttack: siege field discipline', () => {
  const catapult = unit({ type: 'catapult', attack: 6, defense: 1 });
  const chariot = unit({ type: 'chariot', attack: 4, defense: 2 });

  it('keeps catapults out of open-field fights', () => {
    // Great odds — and still refused: "in the field, they will be slaughtered
    // by the faster units, so do not use them there."
    const decision = decideAiAttack(catapult, chariot, { defenderTile: grassland });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('siege_field_discipline');
    expect(decision.chance).toBeGreaterThan(0.7);
  });

  it('lets catapults fire at a unit inside a city', () => {
    const decision = decideAiAttack(catapult, chariot, { defenderTile: grassland, defenderInCity: true });
    expect(decision.allow).toBe(true);
  });

  it('lets catapults fire from a fortress', () => {
    const decision = decideAiAttack(catapult, chariot, {
      defenderTile: { ...grassland, improvement: 'fortress' },
    });
    expect(decision.allow).toBe(true);
  });

  it('lets catapults fight in the open when a front-line unit supports them', () => {
    const decision = decideAiAttack(catapult, chariot, { defenderTile: grassland, support: 1 });
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('focus_fire');
  });
});

describe('decideAiAttack: soft targets', () => {
  it('always lets a unit cut down an enemy civilian', () => {
    // A settler in the woods still dies: denying an enemy city is worth worse
    // than even odds.
    const warrior = unit();
    const settler = unit({ type: 'settler', attack: 0, defense: 1 });
    const decision = decideAiAttack(warrior, settler, { defenderTile: forest });
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('soft_target');
  });

  it('always lets scouts be hunted down', () => {
    const decision = decideAiAttack(unit(), unit({ type: 'scout', attack: 0.5, defense: 1 }), {
      defenderTile: forest,
    });
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('soft_target');
  });
});
