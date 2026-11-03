/**
 * The chronicle — full-screen illustrated story cards.
 *
 * Pinned here:
 *   * the DAWN story event at engine start (the game's opening card),
 *   * the queue → dialog plumbing (`queueStory` opens unless a dialog is
 *     busy, `hideDialog` promotes the queued card),
 *   * the two world events that became story cards: the barbarian
 *     conquest (nobody else tells it) and the nomad migration,
 *   * the player's own city falling stays with the CityEventModal — no
 *     double telling,
 *   * and AI-vs-AI spectating gets no dialogs at all.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { useGameStore } from '@/stores/GameStore';
import { STORY_EVENTS } from '@/data/StoryEvents';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

const makeEngine = async () => {
  const engine = new GameEngine(null);
  (engine as any).sleep = () => Promise.resolve();
  (engine as any).isPaused = true;
  await engine.initialize({
    numberOfCivilizations: 2,
    mapType: 'CLOSEUP_1V1',
    devMode: false,
    startingGold: 100,
  });
  const router = new EngineEventRouter(engine);
  engine.onStateChange = (type: string, data?: any) => router.handle(type, data);
  return { engine, router };
};

const cityPayload = (over: Record<string, unknown> = {}) => ({
  city: { id: 'c1', name: 'Troy', col: 5, row: 5, population: 3, civilizationId: 1 },
  capturedBy: BARBARIAN_CIV_ID,
  originalCiv: 1,
  ...over,
});

describe('The chronicle', () => {
  beforeEach(() => {
    useGameStore.getState().actions.hideDialog?.();
    useGameStore.setState({ storyQueue: [], cityEventQueue: [] });
    useGameStore.getState().actions.clearCityEvents();
    useGameStore.getState().actions.hideDialog();
  });

  afterEach(() => {
    useGameStore.setState({ storyQueue: [], cityEventQueue: [] });
    useGameStore.getState().actions.hideDialog();
  });

  it('the dawn card is queued at engine start of a fresh human game', async () => {
    const engine = new GameEngine(useGameStore.getState().actions);
    (engine as any).sleep = () => Promise.resolve();
    (engine as any).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });

    // The engine announces the dawn through the storeActions channel —
    // `onStateChange` is not attached until the game screen mounts.
    expect(useGameStore.getState().storyQueue[0]).toMatchObject({ storyId: 'dawn' });
    expect(useGameStore.getState().uiState.activeDialog).toBe('story');
    expect(STORY_EVENTS.dawn.titleKey).toBe('story.dawn.title');
  });

  it('a spectated AI-vs-AI game queues no dawn (nobody to tell)', async () => {
    const engine = new GameEngine(useGameStore.getState().actions);
    (engine as any).sleep = () => Promise.resolve();
    (engine as any).isPaused = true;

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      humanPlayerIds: [],
    });

    expect(useGameStore.getState().storyQueue).toHaveLength(0);
    expect(useGameStore.getState().uiState.activeDialog).not.toBe('story');
  });

  it('queueStory opens the card, and Continue pops the queue', async () => {
    await makeEngine();
    const store = useGameStore.getState();

    store.actions.queueStory({ storyId: 'dawn' });
    expect(useGameStore.getState().storyQueue).toHaveLength(1);
    expect(useGameStore.getState().uiState.activeDialog).toBe('story');

    useGameStore.getState().actions.dequeueStory();
    expect(useGameStore.getState().storyQueue).toHaveLength(0);
    expect(useGameStore.getState().uiState.activeDialog).toBeNull();
  });

  it('a card arriving while another dialog is busy waits, then surfaces on close', async () => {
    await makeEngine();
    const store = useGameStore.getState();

    store.actions.showDialog('help');
    store.actions.queueStory({ storyId: 'dawn' });
    expect(useGameStore.getState().uiState.activeDialog).toBe('help'); // not stolen
    expect(useGameStore.getState().storyQueue).toHaveLength(1);

    store.actions.hideDialog(); // the help screen closes
    expect(useGameStore.getState().uiState.activeDialog).toBe('story'); // promoted
  });

  it('the barbarian conquest of a rival city becomes a story card', async () => {
    const { router } = await makeEngine();

    router.handle('CITY_CAPTURED', cityPayload());

    const queue = useGameStore.getState().storyQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ storyId: 'hordeConquest', params: { city: 'Troy' } });
    expect(useGameStore.getState().cityEventQueue).toHaveLength(0); // not the city modal
  });

  it("the player's own city falling stays with the CityEventModal", async () => {
    const { router } = await makeEngine();

    router.handle(
      'CITY_CAPTURED',
      cityPayload({ originalCiv: 0, city: { id: 'c0', name: 'Rome', col: 2, row: 2, population: 4, civilizationId: 0 } }),
    );

    expect(useGameStore.getState().storyQueue).toHaveLength(0); // no double telling
    expect(useGameStore.getState().cityEventQueue).toHaveLength(1);
  });

  it('the nomad migration becomes a story card (toast retired)', async () => {
    const { router } = await makeEngine();

    router.handle('NOMAD_MIGRATED', { city: 'BarbTown' });

    const queue = useGameStore.getState().storyQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ storyId: 'nomadMigration', params: { city: 'BarbTown' } });
    expect(useGameStore.getState().uiState.activeDialog).toBe('story');
  });

  it('opens no card in an AI-vs-AI run (a spectator gets no dialogs)', async () => {
    const { engine, router } = await makeEngine();
    for (const civ of engine.civilizations) civ.isHuman = false;

    router.handle('NOMAD_MIGRATED', { city: 'BarbTown' });
    router.handle('CITY_CAPTURED', cityPayload());

    expect(useGameStore.getState().storyQueue).toHaveLength(0);
    expect(useGameStore.getState().uiState.activeDialog).not.toBe('story');
  });

  it('every story definition is complete (art, tone, three keys)', () => {
    for (const def of Object.values(STORY_EVENTS)) {
      // Any raster format — the generated art lands as png/jpg/webp.
      expect(def.image).toMatch(/^\/assets\/story\/[a-z_]+\.(png|jpg|webp)$/);
      expect(def.tone).toBeTruthy();
      expect(def.eyebrowKey).toMatch(/^story\./);
      expect(def.titleKey).toMatch(/^story\./);
      expect(def.bodyKey).toMatch(/^story\./);
    }
  });
});
