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

    engine.turnManager.startTurn(0);
    expect(engine.civilizations[0].currentResearch).toBeFalsy();

    await turnManager!.endHumanTurn();

    const research = engine.civilizations[0].currentResearch;
    expect(research).toBeTruthy();
    expect((engine.civilizations[0].technologies ?? []).map(String)).not.toContain(research!.id);
  });
});
