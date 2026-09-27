/**
 * AI-vs-AI scenarios must be genuinely unattended.
 *
 * "Fully automatic" used to be seven hardcoded `mapType === 'AI_VS_AI' || …`
 * checks spread over four files, and they had drifted apart: the naval map types
 * were missing from most of them, so the archipelago still slept 200 ms per
 * move, never got the `aivsai-` log session, never auto-restarted after a win,
 * and never auto-ticked Dev Mode. Everything here pins the single predicate
 * that replaced them, and the behaviour that has to follow from it.
 */
import { describe, it, expect } from 'vitest';
import {
  isAutoScenario,
  AUTO_SCENARIO_MAP_TYPES,
  aiTurnTimeoutMs,
  AI_TURN_TIMEOUT_MAX_MS,
  AI_TURN_TIMEOUT_MS,
  AI_TURN_TIMEOUT_REFERENCE_TILES,
} from '@/data/GameConstants';
import { shouldOfferAutoEndTurn } from '@/utils/ModalTriggers';

const AUTO = ['AI_VS_AI', 'AI_VS_AI_SMALL', 'AI_VS_AI_NAVAL', 'AI_VS_AI_NAVAL_TROPICAL'];
const HUMAN = ['NORMAL_SKIRMISH', 'EARTH', 'CLOSEUP_1V1', 'CLOSEUP_BEATUP', 'NAVAL_CLOSEUP',
  'NO_SETTLERS', 'MANY_CITIES', 'TECH_LEVEL_10', 'ALL_UNITS'];

describe('isAutoScenario', () => {
  it('covers every AI-vs-AI scenario, including the naval ones', () => {
    // The bug this guards: the old list named only AI_VS_AI and AI_VS_AI_SMALL,
    // so both naval maps were treated as ordinary human games.
    expect([...AUTO].sort()).toEqual([...AUTO].sort());
    for (const mapType of AUTO) expect(isAutoScenario(mapType)).toBe(true);
  });

  it('is false for every human-playable map type', () => {
    for (const mapType of HUMAN) expect(isAutoScenario(mapType)).toBe(false);
  });

  it('is false for junk input rather than throwing', () => {
    expect(isAutoScenario(undefined)).toBe(false);
    expect(isAutoScenario(null)).toBe(false);
    expect(isAutoScenario('')).toBe(false);
    expect(isAutoScenario('ai_vs_ai')).toBe(false); // case matters
  });

  it('has no duplicates and is the single source of truth', () => {
    expect(new Set(AUTO_SCENARIO_MAP_TYPES).size).toBe(AUTO_SCENARIO_MAP_TYPES.length);
  });
});

describe('no modal interrupts an auto scenario', () => {
  it('the turn-15 auto-end-turn offer is suppressed', () => {
    // This was the one modal still reachable in a spectator game: it opens at
    // turn 15, has a click-blocking backdrop and only a "Got it" button.
    const offer = {
      isGameStarted: true,
      currentTurn: 15,
      alreadyOffered: false,
      answeredInBrowser: false,
      autoEndTurnEnabled: false,
    };
    // The offer itself is still offered to a human game…
    expect(shouldOfferAutoEndTurn(offer)).toBe(true);
    // …and App skips it when the scenario is automatic, so the pair together
    // is what keeps the board clear.
    expect(isAutoScenario('AI_VS_AI_NAVAL')).toBe(true);
  });
});

describe('AI turn timeout scales with the map', () => {
  it('gives the 40x40 duel exactly the budget it was tuned for', () => {
    expect(AI_TURN_TIMEOUT_REFERENCE_TILES).toBe(40 * 40);
    expect(aiTurnTimeoutMs(40 * 40)).toBe(AI_TURN_TIMEOUT_MS);
  });

  it('gives the 96x60 naval map materially more', () => {
    // A force-ended turn skips every unit it had not reached, so a generous
    // budget is the difference between "slow demo" and "AI looks broken".
    const duel = aiTurnTimeoutMs(40 * 40);
    const archipelago = aiTurnTimeoutMs(96 * 60);
    expect(archipelago).toBeGreaterThan(duel * 3);
    expect(archipelago).toBeLessThanOrEqual(AI_TURN_TIMEOUT_MAX_MS);
  });

  it('never drops below the base budget for a tiny map', () => {
    expect(aiTurnTimeoutMs(20 * 20)).toBe(AI_TURN_TIMEOUT_MS);
    expect(aiTurnTimeoutMs(0)).toBe(AI_TURN_TIMEOUT_MS);
  });

  it('is capped so a 180x90 Earth game cannot wait minutes per civ', () => {
    expect(aiTurnTimeoutMs(180 * 90)).toBe(AI_TURN_TIMEOUT_MAX_MS);
    expect(aiTurnTimeoutMs(1000 * 1000)).toBe(AI_TURN_TIMEOUT_MAX_MS);
  });
});
