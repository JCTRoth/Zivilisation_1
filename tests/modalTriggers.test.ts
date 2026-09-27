/**
 * One-shot modal triggers — "No Research Selected" and the "Auto. turn
 * ending" offer. These are the pure decisions App.tsx uses to open the
 * dialogs; the UI itself is covered by the Playwright specs.
 */
import { describe, it, expect } from 'vitest';
import { shouldOfferAutoEndTurn, shouldPromptForResearch } from '@/utils/ModalTriggers';
import { AUTO_END_TURN_OFFER_TURN, RESEARCH_UNLOCK_ROUND } from '@/data/GameConstants';

describe('"No Research Selected" prompt', () => {
  const ready = {
    isGameStarted: true,
    alreadyPrompted: false,
    researchUnlocked: true,
    hasHumanCiv: true,
    hasCurrentResearch: false,
    hasResearchableTech: true,
  };

  it('shows when research is unlocked and nothing is selected', () => {
    expect(shouldPromptForResearch(ready)).toBe(true);
    expect(RESEARCH_UNLOCK_ROUND).toBe(5);
  });

  it('never shows before the game starts', () => {
    expect(shouldPromptForResearch({ ...ready, isGameStarted: false })).toBe(false);
  });

  it('never shows during the opening rounds', () => {
    expect(shouldPromptForResearch({ ...ready, researchUnlocked: false })).toBe(false);
  });

  it('does not nag once a technology is selected', () => {
    expect(shouldPromptForResearch({ ...ready, hasCurrentResearch: true })).toBe(false);
  });

  it('does not show when there is nothing left to research', () => {
    expect(shouldPromptForResearch({ ...ready, hasResearchableTech: false })).toBe(false);
  });

  it('does not show without a human civilization to choose for', () => {
    expect(shouldPromptForResearch({ ...ready, hasHumanCiv: false })).toBe(false);
  });

  it('asks once per game engine', () => {
    expect(shouldPromptForResearch({ ...ready, alreadyPrompted: true })).toBe(false);
  });
});

describe('"Auto. turn ending" offer', () => {
  const ready = {
    isGameStarted: true,
    currentTurn: 1,
    alreadyOffered: false,
    answeredInBrowser: false,
    autoEndTurnEnabled: false,
  };

  it('is offered at turn 15, not before', () => {
    expect(AUTO_END_TURN_OFFER_TURN).toBe(15);
    expect(shouldOfferAutoEndTurn({ ...ready, currentTurn: AUTO_END_TURN_OFFER_TURN - 1 })).toBe(false);
    expect(shouldOfferAutoEndTurn({ ...ready, currentTurn: AUTO_END_TURN_OFFER_TURN })).toBe(true);
    expect(shouldOfferAutoEndTurn({ ...ready, currentTurn: AUTO_END_TURN_OFFER_TURN + 5 })).toBe(true);
  });

  it('is not offered when the feature is already on', () => {
    expect(
      shouldOfferAutoEndTurn({ ...ready, currentTurn: 20, autoEndTurnEnabled: true }),
    ).toBe(false);
  });

  it('never shows before the game starts', () => {
    expect(shouldOfferAutoEndTurn({ ...ready, isGameStarted: false, currentTurn: 40 })).toBe(false);
  });

  it('is offered once per session', () => {
    expect(shouldOfferAutoEndTurn({ ...ready, currentTurn: 20, alreadyOffered: true })).toBe(false);
  });

  it('never comes back once answered in this browser', () => {
    expect(
      shouldOfferAutoEndTurn({ ...ready, currentTurn: 20, answeredInBrowser: true }),
    ).toBe(false);
  });
});
