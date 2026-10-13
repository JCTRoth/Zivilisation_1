/**
 * The audience screen — the dialog a "unit meeting unit" opens.
 *
 * Two ways in: a diplomat asks to meet a leader (greeting), or an AI civ puts
 * its own proposal to the player (offer). Both have to land on the same screen,
 * and dismissing it has to hand the turn back — the audience defers auto-end
 * like every other decision screen.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';

describe('Audience screen', () => {
  let engine: GameEngine;
  let router: EngineEventRouter;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    (engine as any).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });

    router = new EngineEventRouter(engine);
    engine.onStateChange = (type: string, data?: any) => {
      router.handle(type, data);
    };

    useGameStore.getState().actions.hideDialog();
    useGameStore.getState().actions.clearAudience();
  });

  afterEach(() => {
    useGameStore.getState().actions.hideDialog();
    useGameStore.getState().actions.clearAudience();
  });

  it('opens on an AI-initiated offer, carrying the terms', () => {
    engine.onStateChange('AI_DIPLOMACY_OFFER', {
      fromCivId: 1,
      toCivId: 0,
      action: 'offer_tech_exchange',
      techOffered: 'iron_working',
      techRequested: 'pottery',
      message: 'Aztecs offers an Exchange of Knowledge.',
    });

    const state = useGameStore.getState();
    expect(state.uiState.activeDialog).toBe('audience');
    expect(state.audienceNotice).toMatchObject({
      civId: 1,
      mode: 'offer',
      action: 'offer_tech_exchange',
      techOffered: 'iron_working',
      techRequested: 'pottery',
    });
  });

  it('opens as a plain audience when a diplomat is received', () => {
    useGameStore.getState().actions.openAudience({
      civId: 1,
      mode: 'greeting',
      message: '',
    });

    const state = useGameStore.getState();
    expect(state.uiState.activeDialog).toBe('audience');
    expect(state.audienceNotice?.mode).toBe('greeting');
  });

  it('closing clears the notice and hands the dialog slot back', () => {
    useGameStore.getState().actions.openAudience({ civId: 1, mode: 'greeting', message: '' });
    expect(useGameStore.getState().uiState.activeDialog).toBe('audience');

    useGameStore.getState().actions.clearAudience();

    const state = useGameStore.getState();
    expect(state.audienceNotice).toBeNull();
    expect(state.uiState.activeDialog).toBeNull();
  });

  it('never opens in an AI-vs-AI run (no human to answer it)', async () => {
    // AI-vs-AI is "every civ is AI" to the event layer — offers are resolved
    // engine-side there, and no dialog may steal the spectator's screen.
    const spectatorEngine = new GameEngine(null);
    (spectatorEngine as any).sleep = () => Promise.resolve();
    (spectatorEngine as any).isPaused = true;
    await spectatorEngine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    for (const civ of spectatorEngine.civilizations) civ.isHuman = false;
    const spectatorRouter = new EngineEventRouter(spectatorEngine);
    spectatorEngine.onStateChange = (type: string, data?: any) => spectatorRouter.handle(type, data);

    spectatorEngine.onStateChange('AI_DIPLOMACY_OFFER', {
      fromCivId: 1,
      toCivId: 0,
      action: 'propose_peace',
    });

    expect(useGameStore.getState().uiState.activeDialog).not.toBe('audience');
  });
});
