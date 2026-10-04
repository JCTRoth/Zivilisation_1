/**
 * Wonder UI state: the status colours the overview screen paints and the two
 * wonder dialogs (celebration + production conflict) that the engine events
 * open through the zustand store.
 *
 * The components themselves never run here (the repo's unit tests are
 * DOM-free) — everything they render is derived from these pure functions and
 * this store state, which is exactly what is asserted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import { EngineEventRouter } from '@/utils/EngineEventHandlers';
import { computeWonderStatuses } from '@/data/WonderData';
import GameEngine from '@/game/engine/GameEngine';
import { world as wrapWorld, type TestWorld } from './helpers/world';
import type { WonderDialogEntry } from '../types/game';

const store = () => useGameStore.getState();

describe('wonders overview status colours (store data → status)', () => {
  const cities = (specs: Array<Partial<{ id: string; civilizationId: number; buildings: string[]; currentProduction: { itemType: string } | null; buildQueue: Array<{ itemType: string }> }>>) =>
    specs.map((s) => ({
      id: s.id ?? 'c',
      civilizationId: s.civilizationId ?? 0,
      buildings: s.buildings ?? [],
      currentProduction: s.currentProduction ?? null,
      buildQueue: s.buildQueue ?? [],
    }));

  it('maps every situation to the spec colour', () => {
    const civs = [
      { id: 0, technologies: ['pottery', 'map_making'] },
      { id: 1, technologies: [] },
    ];

    const statuses = computeWonderStatuses(
      cities([
        { id: 'mine', civilizationId: 0, buildings: ['hanging_gardens'] },       // green
        { id: 'rival', civilizationId: 1, buildings: ['pyramids'] },             // red
        { id: 'building', civilizationId: 0, currentProduction: { itemType: 'colossus' } }, // blue
        { id: 'raceA', civilizationId: 0, currentProduction: { itemType: 'lighthouse' } },
        { id: 'raceB', civilizationId: 1, currentProduction: { itemType: 'lighthouse' } }, // yellow
        { id: 'rivalOnly', civilizationId: 1, buildQueue: [{ itemType: 'oracle' }] },      // red
      ]),
      civs,
      0,
    );

    expect(statuses.hanging_gardens).toBe('owned');     // green
    expect(statuses.pyramids).toBe('rival');            // red
    expect(statuses.colossus).toBe('building');         // blue
    expect(statuses.lighthouse).toBe('contested');      // yellow
    expect(statuses.oracle).toBe('rival');              // red (rival building only)
    expect(statuses.great_library).toBe('locked');      // grey (no literacy)
    expect(statuses.anaximanders_map).toBe('available');// neutral (map_making known)
  });

  it('a wonder the player is building while a rival OWNS it stays red', () => {
    const statuses = computeWonderStatuses(
      cities([
        { id: 'rivalCity', civilizationId: 1, buildings: ['pyramids'] },
        { id: 'myCity', civilizationId: 0, currentProduction: { itemType: 'pyramids' } },
      ]),
      [{ id: 0, technologies: ['masonry'] }, { id: 1, technologies: [] }],
      0,
    );
    expect(statuses.pyramids).toBe('rival');
  });
});

describe('wonder dialogs (engine events → store queue)', () => {
  let engine: GameEngine;
  let w: TestWorld;
  let router: EngineEventRouter;

  beforeEach(async () => {
    store().actions.resetGameState();
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      mapSeed: 5,
    });
    w = wrapWorld(engine);
    router = new EngineEventRouter(engine);
    engine.onStateChange = (type, data) => router.handle(type, data ?? {});
  });

  afterEach(() => {
    engine.onStateChange = null;
    store().actions.resetGameState();
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  const queue = (): WonderDialogEntry[] => store().wonderDialogQueue;
  const active = () => store().uiState.activeDialog;

  it('a human wonder completion opens the celebration screen', () => {
    const city = w.settle('WonderCity', 4, 4, 0, 2);
    engine.onStateChange?.('WONDER_COMPLETED', {
      cityId: city.id,
      cityName: city.name,
      civilizationId: 0,
      civName: 'TestCiv',
      wonderId: 'pyramids',
    });

    expect(active()).toBe('wonder-completed');
    expect(queue()).toHaveLength(1);
    const entry = queue()[0] as Extract<WonderDialogEntry, { kind: 'completed' }>;
    expect(entry.kind).toBe('completed');
    expect(entry.wonderId).toBe('pyramids');
    expect(entry.wonderName).toBe('Pyramids');
    expect(entry.cityName).toBe('WonderCity');
    expect(entry.isHuman).toBe(true);
  });

  it('consecutive completions queue up and show one after another', () => {
    engine.onStateChange?.('WONDER_COMPLETED', { cityId: 'x', cityName: 'A', civilizationId: 0, civName: 'TestCiv', wonderId: 'pyramids' });
    engine.onStateChange?.('WONDER_COMPLETED', { cityId: 'y', cityName: 'B', civilizationId: 1, civName: 'Rival', wonderId: 'colossus' });

    expect(queue()).toHaveLength(2);
    expect(active()).toBe('wonder-completed');
    expect((queue()[0] as { wonderId: string }).wonderId).toBe('pyramids');

    // Dismissing shows the next one — same dialog, new payload.
    store().actions.dequeueWonderDialog();
    expect(queue()).toHaveLength(1);
    expect(active()).toBe('wonder-completed');
    expect((queue()[0] as { wonderId: string }).wonderId).toBe('colossus');
    expect((queue()[0] as { isHuman: boolean }).isHuman).toBe(false);

    // The last dismissal closes the dialog entirely.
    store().actions.dequeueWonderDialog();
    expect(queue()).toHaveLength(0);
    expect(active()).toBeNull();
  });

  it('an AI wonder completion ALSO opens the screen (Civ1 shows them all)', () => {
    engine.onStateChange?.('WONDER_COMPLETED', { cityId: 'ai', cityName: 'Rome', civilizationId: 1, civName: 'Rival', wonderId: 'lighthouse' });
    expect(active()).toBe('wonder-completed');
    expect((queue()[0] as { isHuman: boolean }).isHuman).toBe(false);
  });

  it('a human production conflict opens the conflict modal with the owner details', () => {
    engine.onStateChange?.('WONDER_PRODUCTION_CONFLICT', {
      cityId: 'loser',
      cityName: 'SlowTown',
      civilizationId: 0,
      wonderId: 'pyramids',
      ownerCityId: 'winner',
      ownerCityName: 'FastTown',
      ownerCivId: 1,
      ownerCivName: 'Rival',
    });

    expect(active()).toBe('wonder-conflict');
    const entry = queue()[0] as Extract<WonderDialogEntry, { kind: 'conflict' }>;
    expect(entry.kind).toBe('conflict');
    expect(entry.wonderId).toBe('pyramids');
    expect(entry.cityName).toBe('SlowTown');
    expect(entry.ownerCityName).toBe('FastTown');
    expect(entry.ownerCivName).toBe('Rival');
  });

  it('conflicts in AI cities never open a dialog for the player', () => {
    engine.onStateChange?.('WONDER_PRODUCTION_CONFLICT', {
      cityId: 'aiCity',
      cityName: 'AiTown',
      civilizationId: 1,
      wonderId: 'pyramids',
      ownerCityId: 'other',
      ownerCityName: 'OtherTown',
      ownerCivId: 0,
      ownerCivName: 'TestCiv',
    });
    expect(queue()).toHaveLength(0);
    expect(active()).toBeNull();
  });

  it('in an AI-vs-AI game no wonder screens pop up at all', async () => {
    // Fresh all-AI world.
    const aiEngine = new GameEngine(null);
    (aiEngine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (aiEngine as unknown as { isPaused: boolean }).isPaused = true;
    await aiEngine.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
      mapSeed: 5,
    });
    const aiRouter = new EngineEventRouter(aiEngine);
    aiEngine.onStateChange = (type, data) => aiRouter.handle(type, data ?? {});

    aiEngine.onStateChange('WONDER_COMPLETED', { cityId: 'a', cityName: 'A', civilizationId: 0, civName: 'X', wonderId: 'pyramids' });
    aiEngine.onStateChange('WONDER_PRODUCTION_CONFLICT', { cityId: 'b', cityName: 'B', civilizationId: 0, wonderId: 'colossus' });

    expect(queue()).toHaveLength(0);
    expect(active()).toBeNull();
    aiEngine.onStateChange = null;
  });
});
