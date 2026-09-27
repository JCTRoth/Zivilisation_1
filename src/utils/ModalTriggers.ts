/**
 * One-shot modal trigger rules.
 *
 * Extracted from App.tsx so "does the modal show?" is a pure decision that can
 * be unit-tested without a DOM. App keeps the side effects (notification, ref
 * guards, opening the dialog); these functions only answer the question.
 */
import { AUTO_END_TURN_OFFER_TURN } from '@/data/GameConstants';

export interface ResearchPromptInput {
  /** A game is running (not the setup screen). */
  isGameStarted: boolean;
  /** The effect already asked for this engine instance. */
  alreadyPrompted: boolean;
  /** Opening rounds are over (GameEngine.isResearchUnlocked). */
  researchUnlocked: boolean;
  /** A human civilization exists to choose for. */
  hasHumanCiv: boolean;
  /** The human civ has a technology selected. */
  hasCurrentResearch: boolean;
  /** There is at least one researchable technology left. */
  hasResearchableTech: boolean;
}

/**
 * The "No Research Selected" modal: shown once per game when research has
 * unlocked and the human player has nothing selected but something to pick.
 */
export function shouldPromptForResearch(input: ResearchPromptInput): boolean {
  return (
    input.isGameStarted &&
    !input.alreadyPrompted &&
    input.researchUnlocked &&
    input.hasHumanCiv &&
    !input.hasCurrentResearch &&
    input.hasResearchableTech
  );
}

export interface AutoEndTurnOfferInput {
  /** A game is running (not the setup screen). */
  isGameStarted: boolean;
  /** Current game turn (1-based). */
  currentTurn: number;
  /** The offer was already shown this session (ref guard). */
  alreadyOffered: boolean;
  /** The offer was answered in this browser before (localStorage flag). */
  answeredInBrowser: boolean;
  /** The feature is already on — there is nothing to offer. */
  autoEndTurnEnabled: boolean;
}

/**
 * The "Auto. turn ending" offer: shown once, at/after
 * {@link AUTO_END_TURN_OFFER_TURN}, until the player answers it in this
 * browser (answering either way sets the localStorage flag).
 */
export function shouldOfferAutoEndTurn(input: AutoEndTurnOfferInput): boolean {
  return (
    input.isGameStarted &&
    !input.alreadyOffered &&
    !input.answeredInBrowser &&
    !input.autoEndTurnEnabled &&
    input.currentTurn >= AUTO_END_TURN_OFFER_TURN
  );
}
