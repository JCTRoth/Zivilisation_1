/**
 * The offline round trip — the promise the whole PWA work rests on.
 *
 * A single-player game is played, saved into the local campaign library,
 * and restored into a fresh engine. The restored game must be *the same
 * game*: the same turn, the same units, the same gold, and the same RNG
 * stream — otherwise a resumed campaign would diverge from the one the
 * player left.
 *
 * The test runs entirely offline: no server, no network, no browser APIs.
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import GameEngine from '@shared/game/engine/GameEngine';
import { headlessRuntime } from '@shared/ports/runtime';
import { AUTOSAVE_SLOT, MANUAL_SAVE_SLOT } from '@shared/ports/campaignStore';
import { createBrowserSaveStore } from '@/pwa/browserSaveStore';
import { makeEngine, type TestWorld } from '../helpers/world';

function snapshot(engine: GameEngine): string {
  return JSON.stringify({
    turn: engine.currentTurn,
    year: engine.currentYear,
    player: engine.activePlayer,
    map: engine.map ? [engine.map.width, engine.map.height] : null,
    units: engine.units.map((u) => [
      u.id, u.type, u.col, u.row, u.health, u.civilizationId, u.movesRemaining,
    ]),
    cities: engine.cities.map((c) => [c.id, c.name, c.population, c.civilizationId]),
    gold: engine.civilizations.map((c) => (c.resources as { gold?: number } | undefined)?.gold),
    techs: engine.technologies.map((t) => t.id ?? t.name),
  });
}

describe('offline round trip', () => {
  it('restores the exact game after a save into the campaign library', async () => {
    const store = createBrowserSaveStore({
      factory: new IDBFactory(),
      storage: null,
      flushDelayMs: 0,
    });
    await store.hydrate();

    const world: TestWorld = await makeEngine({
      seed: 5150,
      rngSeed: 4242,
      numberOfCivilizations: 2,
      saveStore: store,
    });
    world.engine.setPaused(false);
    await world.runTurns(3);

    // The engine writes through the very same store the browser uses.
    expect(world.engine.saveGame(AUTOSAVE_SLOT)).toBe(true);
    await store.flush();

    const before = snapshot(world.engine);
    const expectedStream = Array.from({ length: 8 }, () => world.engine.rng());

    // A fresh engine, a fresh tab, no server — exactly what "Continue"
    // does after the browser is closed and reopened.
    const restored = new GameEngine(null, headlessRuntime, store);
    expect(await restored.loadGame(AUTOSAVE_SLOT)).toBe(true);
    expect(snapshot(restored)).toBe(before);
    expect(Array.from({ length: 8 }, () => restored.rng())).toEqual(expectedStream);
  });

  it('saves a file that the engine can load again (the version gate agrees)', async () => {
    const world = await makeEngine({ seed: 99, rngSeed: 7, numberOfCivilizations: 2 });
    const json = world.engine.getSaveJSON();
    expect(json).toBeTruthy();

    const parsed = JSON.parse(json as string);
    // The file the player exports carries the current save version, and the
    // engine accepts it — the bug that made "Load Game" reject the app's
    // own saves.
    expect(parsed.version).toBe(5);

    const store = createBrowserSaveStore({ factory: new IDBFactory(), storage: null, flushDelayMs: 0 });
    await store.hydrate();
    await store.writeCampaign(MANUAL_SAVE_SLOT, json as string);

    const restored = new GameEngine(null, headlessRuntime, store);
    expect(await restored.loadGame(MANUAL_SAVE_SLOT)).toBe(true);
    expect(restored.currentTurn).toBe(world.engine.currentTurn);
  });

  it('keeps several named campaigns side by side', async () => {
    const store = createBrowserSaveStore({ factory: new IDBFactory(), storage: null, flushDelayMs: 0 });
    await store.hydrate();

    const first = await makeEngine({ seed: 1, rngSeed: 1, numberOfCivilizations: 2 });
    const second = await makeEngine({ seed: 2, rngSeed: 2, numberOfCivilizations: 2 });

    await store.writeCampaign('camp-a', first.engine.getSaveJSON() as string, { name: 'Alpha' });
    await store.writeCampaign('camp-b', second.engine.getSaveJSON() as string, { name: 'Beta' });

    const listed = await store.listCampaigns();
    expect(listed.map((entry) => entry.name).sort()).toEqual(['Alpha', 'Beta']);

    await store.removeCampaign('camp-a');
    const after = await store.listCampaigns();
    expect(after.map((entry) => entry.id)).toEqual(['camp-b']);
  });
});
