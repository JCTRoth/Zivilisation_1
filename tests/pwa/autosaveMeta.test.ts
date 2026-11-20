/**
 * The autosave metadata the War Council shows on its "Continue" card.
 *
 * The metadata used to be scraped out of a `localStorage` blob; it now
 * comes from the campaign library, which means the council can offer to
 * resume a game that was stored under any name — and it survives a reload
 * with no network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { AUTOSAVE_SLOT, MANUAL_SAVE_SLOT } from '@shared/ports/campaignStore';
import { createBrowserSaveStore, setBrowserSaveStore } from '@/pwa/browserSaveStore';
import { readAutosaveMeta, readAutosaveMetaAsync } from '@/utils/Autosave';

function blob(turn: number, name: string): string {
  return JSON.stringify({
    version: 5,
    currentTurn: turn,
    currentYear: -1000,
    humanCivId: 0,
    civilizations: [{ id: 0, name, isHuman: true }],
  });
}

afterEach(() => {
  setBrowserSaveStore(null);
});

describe('autosave metadata', () => {
  it('prefers the autosave over the manual slot', async () => {
    const store = createBrowserSaveStore({ factory: new IDBFactory(), storage: null, flushDelayMs: 0 });
    await store.hydrate();
    await store.writeCampaign(AUTOSAVE_SLOT, blob(9, 'Rome'));
    await store.writeCampaign(MANUAL_SAVE_SLOT, blob(3, 'Rome'));
    setBrowserSaveStore(store);

    const meta = await readAutosaveMetaAsync();
    expect(meta?.slot).toBe(AUTOSAVE_SLOT);
    expect(meta?.turn).toBe(9);
    expect(meta?.civilizationName).toBe('Rome');
  });

  it('falls back to the manual slot', async () => {
    const store = createBrowserSaveStore({ factory: new IDBFactory(), storage: null, flushDelayMs: 0 });
    await store.hydrate();
    await store.writeCampaign(MANUAL_SAVE_SLOT, blob(4, 'Egypt'));
    setBrowserSaveStore(store);

    const meta = await readAutosaveMetaAsync();
    expect(meta?.slot).toBe(MANUAL_SAVE_SLOT);
    expect(meta?.turn).toBe(4);
    expect(meta?.civilizationName).toBe('Egypt');
  });

  it('reports nothing when the library is empty', async () => {
    const store = createBrowserSaveStore({ factory: new IDBFactory(), storage: null, flushDelayMs: 0 });
    await store.hydrate();
    setBrowserSaveStore(store);
    expect(await readAutosaveMetaAsync()).toBeNull();
  });

  it('the synchronous read reflects what is already in the cache', async () => {
    const store = createBrowserSaveStore({ factory: new IDBFactory(), storage: null, flushDelayMs: 0 });
    await store.hydrate();
    setBrowserSaveStore(store);
    // Nothing has been hydrated into the shared store yet.
    expect(readAutosaveMeta()).toBeNull();

    await store.writeCampaign(AUTOSAVE_SLOT, blob(11, 'Rome'));
    expect(readAutosaveMeta()?.turn).toBe(11);
  });
});
