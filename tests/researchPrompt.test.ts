/**
 * Research selection prompt + "no research selected" fallback.
 *
 * - At game start the player has no research selected, so the UI asks for a
 *   choice (see App.tsx).
 * - Auto-end turn is deferred while nothing is selected
 *   (EngineEventHandlers.onCheckAutoEndTurn) — covered in
 *   autoEndTurnScreen.test.ts.
 * - If the player ends the turn without choosing anything, the engine
 *   researches a random AVAILABLE technology so science never sits idle
 *   (GameEngine.autoSelectResearch + TurnManager.endHumanTurn).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { RESEARCH_UNLOCK_ROUND } from '@/data/GameConstants';

describe('Research selection (start of game)', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
  });

  afterEach(() => {
    engine = null as unknown as GameEngine;
  });

  it('starts with no research selected but technologies available', () => {
    const human = engine.civilizations[0];
    expect(human.isHuman).toBe(true);
    expect(human.currentResearch).toBeFalsy();
    expect(engine.hasResearchableTech(0)).toBe(true);
    expect(engine.availableResearchFor(0).length).toBeGreaterThan(0);
  });

  it('only offers technologies the civ can actually research', () => {
    const human = engine.civilizations[0];
    const owned = new Set((human.technologies ?? []).map(String));
    for (const tech of engine.availableResearchFor(0)) {
      expect(owned.has(String(tech.id))).toBe(false);
      for (const prereq of tech.prerequisites ?? []) {
        expect(owned.has(String(prereq))).toBe(true);
      }
    }
  });

  it('autoSelectResearch picks a random available tech and starts it', () => {
    // Research is locked until the unlock round — open it first.
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    const picked = engine.autoSelectResearch(0);
    expect(picked).toBeTruthy();
    expect(engine.civilizations[0].currentResearch?.id).toBe(picked);
    // Never picks something the civ already owns.
    expect((engine.civilizations[0].technologies ?? []).map(String)).not.toContain(picked);
    // ...and refuses to override an existing selection.
    expect(engine.autoSelectResearch(0)).toBeNull();
  });

  it('ending a turn without a selection auto-researches instead of idling', async () => {
    const turnManager = (engine as unknown as { turnManager?: { endHumanTurn: () => Promise<void> } }).turnManager;
    expect(turnManager).toBeDefined();

    // Research only starts after the opening rounds — unlock it first.
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    engine.turnManager.startTurn(0);
    expect(engine.civilizations[0].currentResearch).toBeFalsy();

    await turnManager!.endHumanTurn();

    const research = engine.civilizations[0].currentResearch;
    expect(research).toBeTruthy();
    expect((engine.civilizations[0].technologies ?? []).map(String)).not.toContain(research!.id);
  });

  it('the opening rounds run without research and without auto-selecting one', async () => {
    expect(engine.isResearchUnlocked()).toBe(false);

    const turnManager = (engine as unknown as { turnManager?: { endHumanTurn: () => Promise<void> } }).turnManager;
    engine.turnManager.startTurn(0);
    await turnManager!.endHumanTurn();

    // No prompt/auto-pick yet: the science simply waits for the unlock round.
    expect(engine.civilizations[0].currentResearch).toBeFalsy();

    // Research unlocks on round 5, so round 4 is still an opening round …
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND - 1 });
    expect(engine.isResearchUnlocked()).toBe(false);
    // … and round 5 is the first one that may research.
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    expect(engine.isResearchUnlocked()).toBe(true);
  });

  it('research stays locked for the first five rounds', () => {
    // Guard rail: the opening period is a design decision, not an accident.
    expect(RESEARCH_UNLOCK_ROUND).toBe(5);
  });
});

describe('The research lock is enforced by the engine itself', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
  });

  afterEach(() => {
    engine = null as unknown as GameEngine;
  });

  it('setResearch() refuses every selection during the opening rounds', () => {
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND - 1 });
    expect(engine.isResearchUnlocked()).toBe(false);

    const tech = engine.availableResearchFor(0)[0];
    expect(tech).toBeDefined();
    // Human AND AI civs are locked out alike — the rule has one home.
    expect(engine.setResearch(0, tech.id)).toBe(false);
    expect(engine.setResearch(1, tech.id)).toBe(false);
    for (const civ of engine.civilizations) {
      expect(civ.currentResearch).toBeFalsy();
    }

    // From the unlock round on the very same call works.
    engine.roundManager.restoreState({ roundNumber: RESEARCH_UNLOCK_ROUND });
    expect(engine.setResearch(0, tech.id)).toBe(true);
    expect(engine.civilizations[0].currentResearch).toBeTruthy();
  });

  it('autoSelectResearch() refuses during the opening rounds too', () => {
    engine.roundManager.restoreState({ roundNumber: 1 });
    expect(engine.autoSelectResearch(0)).toBeNull();
    expect(engine.civilizations[0].currentResearch).toBeFalsy();
  });

  it('the opening rounds play out with no research and no progress at all', () => {
    engine.roundManager.restoreState({ roundNumber: 1 });
    const techsBefore = engine.civilizations.map((c) => (c.technologies ?? []).length);
    const tm = engine.turnManager as unknown as { advanceTurn: () => void };

    // Every turn of every opening round, including the AI turns: whatever
    // asks for research (AI selector, auto-select on turn end) must be
    // refused by the engine, so nothing starts and nothing completes.
    for (let i = 0; i < (RESEARCH_UNLOCK_ROUND - 2) * 2; i++) tm.advanceTurn();

    expect(engine.isResearchUnlocked()).toBe(false);
    expect((tm as unknown as { roundNumber: number }).roundNumber).toBe(RESEARCH_UNLOCK_ROUND - 1);
    engine.civilizations.forEach((civ, i) => {
      expect(civ.currentResearch).toBeFalsy();
      expect(civ.researchProgress ?? 0).toBe(0);
      expect((civ.technologies ?? []).length).toBe(techsBefore[i]);
    });
  });
});
