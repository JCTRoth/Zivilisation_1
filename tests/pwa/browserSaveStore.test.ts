/**
 * The browser save store — the synchronous `SaveStore` facade over the
 * asynchronous campaign library.
 *
 * The behaviour under test is what the offline story depends on:
 *  - the engine's synchronous get/set keeps working unchanged,
 *  - writes reach IndexedDB (or the localStorage fallback),
 *  - a legacy `localStorage` save is migrated without ever losing the only
 *    copy of it.
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { AUTOSAVE_SLOT, MANUAL_SAVE_SLOT } from '@shared/ports/campaignStore';
import { createBrowserSaveStore, defaultCampaignName } from '@/pwa/browserSaveStore';
import { createIndexedDbCampaignStore } from '@/pwa/indexedDbCampaignStore';

/** A minimal in-memory `Storage`. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function saveBlob(version = 5, turn = 12): string {
  return JSON.stringify({
    version,
    currentTurn: turn,
    currentYear: -1000,
    humanCivId: 0,
    civilizations: [{ id: 0, name: 'Rome', isHuman: true }],
  });
}

/**
 * An IndexedDB that opens and reads fine but refuses every write because the
 * device is out of space.
 */
function quotaLimitedFactory(): IDBFactory {
  const quotaError = Object.assign(new Error('quota exceeded'), {
    name: 'QuotaExceededError',
  });

  const okRequest = <T>(result: T): IDBRequest<T> => {
    const request: Record<string, unknown> = { result, error: null };
    setTimeout(() => (request.onsuccess as (() => void) | undefined)?.(), 0);
    return request as unknown as IDBRequest<T>;
  };

  const failingRequest = (): IDBRequest<unknown> => {
    const request: Record<string, unknown> = { result: undefined, error: quotaError };
    setTimeout(() => (request.onerror as (() => void) | undefined)?.(), 0);
    return request as unknown as IDBRequest<unknown>;
  };

  const objectStore = {
    getAll: () => okRequest([]),
    get: () => okRequest(undefined),
    delete: () => okRequest(undefined),
    put: () => failingRequest(),
  };

  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => objectStore,
      error: null,
      onabort: null,
      onerror: null,
    }),
  };

  const openRequest: Record<string, unknown> = { result: database, error: null };
  setTimeout(() => (openRequest.onsuccess as (() => void) | undefined)?.(), 0);

  return { open: () => openRequest } as unknown as IDBFactory;
}

describe('browser save store', () => {
  it('reads and writes synchronously, like the engine expects', () => {
    const store = createBrowserSaveStore({ factory: null, storage: new MemoryStorage() });
    expect(store.get(MANUAL_SAVE_SLOT)).toBeNull();
    store.set(MANUAL_SAVE_SLOT, saveBlob());
    expect(store.get(MANUAL_SAVE_SLOT)).toBe(saveBlob());
  });

  it('writes through to IndexedDB and hydrates back', async () => {
    const factory = new IDBFactory();
    const storage = new MemoryStorage();
    const first = createBrowserSaveStore({ factory, storage, flushDelayMs: 0 });
    await first.hydrate();
    expect(first.mode).toBe('indexeddb');

    first.set(AUTOSAVE_SLOT, saveBlob(5, 33));
    await first.flush();

    const second = createBrowserSaveStore({ factory, storage, flushDelayMs: 0 });
    await second.hydrate();
    expect(second.get(AUTOSAVE_SLOT)).toBe(saveBlob(5, 33));
    expect(second.campaignMeta(AUTOSAVE_SLOT)?.turn).toBe(33);
  });

  it('migrates a legacy localStorage save into the library', async () => {
    const factory = new IDBFactory();
    const storage = new MemoryStorage();
    const legacy = saveBlob(5, 7);
    storage.setItem(AUTOSAVE_SLOT, legacy);

    const store = createBrowserSaveStore({ factory, storage, flushDelayMs: 0 });
    await store.hydrate();

    expect(store.get(AUTOSAVE_SLOT)).toBe(legacy);
    // The legacy key is only dropped once the campaign is safely stored.
    expect(storage.getItem(AUTOSAVE_SLOT)).toBeNull();
    const idb = createIndexedDbCampaignStore(factory);
    expect(await idb.read(AUTOSAVE_SLOT)).toBe(legacy);
  });

  it('keeps the legacy key in place when IndexedDB is unavailable', async () => {
    const storage = new MemoryStorage();
    const legacy = saveBlob(5, 7);
    storage.setItem(AUTOSAVE_SLOT, legacy);

    const store = createBrowserSaveStore({ factory: null, storage, flushDelayMs: 0 });
    await store.hydrate();

    expect(store.mode).toBe('localstorage');
    expect(store.get(AUTOSAVE_SLOT)).toBe(legacy);
    // The localStorage tier keeps the blob under its own key — removing it
    // would destroy the only copy.
    expect(storage.getItem(AUTOSAVE_SLOT)).toBe(legacy);
  });

  it('falls back to localStorage when IndexedDB cannot be opened', async () => {
    const storage = new MemoryStorage();
    const brokenFactory = {
      open() {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;

    const store = createBrowserSaveStore({ factory: brokenFactory, storage, flushDelayMs: 0 });
    await store.hydrate();
    expect(store.mode).toBe('localstorage');

    store.set(MANUAL_SAVE_SLOT, saveBlob());
    await store.flush();
    expect(storage.getItem(MANUAL_SAVE_SLOT)).toBe(saveBlob());
  });

  it('falls back to localStorage when the device is full', async () => {
    const storage = new MemoryStorage();
    const store = createBrowserSaveStore({
      factory: quotaLimitedFactory(),
      storage,
      flushDelayMs: 0,
    });
    await store.hydrate();
    // The database opens, so the store starts on the big tier.
    expect(store.mode).toBe('indexeddb');

    store.set(MANUAL_SAVE_SLOT, saveBlob());
    await store.flush();

    // The write was refused for lack of space, so the store steps down to
    // localStorage and the save is not lost.
    expect(store.mode).toBe('localstorage');
    expect(storage.getItem(MANUAL_SAVE_SLOT)).toBe(saveBlob());
  });

  it('derives campaign metadata from the save blob', async () => {
    const store = createBrowserSaveStore({ factory: null, storage: new MemoryStorage() });
    await store.hydrate();
    const meta = await store.writeCampaign('campaign-1', saveBlob(5, 21), { name: 'My campaign' });

    expect(meta.name).toBe('My campaign');
    expect(meta.turn).toBe(21);
    expect(meta.year).toBe(-1000);
    expect(meta.civilizationName).toBe('Rome');
    expect(meta.version).toBe(5);
    expect(meta.kind).toBe('manual');
    expect(meta.sizeBytes).toBe(saveBlob(5, 21).length);
  });

  it('lists campaigns newest first and removes them', async () => {
    const store = createBrowserSaveStore({ factory: null, storage: new MemoryStorage() });
    await store.hydrate();
    await store.writeCampaign('a', saveBlob(5, 1), { updatedAt: 100 });
    await store.writeCampaign('b', saveBlob(5, 2), { updatedAt: 200 });

    const listed = await store.listCampaigns();
    expect(listed.map((entry) => entry.id)).toEqual(['b', 'a']);

    await store.removeCampaign('a');
    const after = await store.listCampaigns();
    expect(after.map((entry) => entry.id)).toEqual(['b']);
    expect(store.get('a')).toBeNull();
  });

  it('does not roll back a write that happened while the library was loading', async () => {
    const factory = new IDBFactory();
    const storage = new MemoryStorage();
    const seed = createBrowserSaveStore({ factory, storage, flushDelayMs: 0 });
    await seed.hydrate();
    await seed.writeCampaign(MANUAL_SAVE_SLOT, saveBlob(5, 1));

    const store = createBrowserSaveStore({ factory, storage, flushDelayMs: 0 });
    const hydrating = store.hydrate();
    // The player saves while the library is still loading.
    store.set(MANUAL_SAVE_SLOT, saveBlob(5, 99));
    await hydrating;

    expect(store.get(MANUAL_SAVE_SLOT)).toBe(saveBlob(5, 99));
  });

  it('shows a campaign that was written but not yet flushed', async () => {
    const store = createBrowserSaveStore({
      factory: null,
      storage: new MemoryStorage(),
      flushDelayMs: 10_000,
    });
    await store.hydrate();
    store.set(AUTOSAVE_SLOT, saveBlob());
    const listed = await store.listCampaigns();
    expect(listed.map((entry) => entry.id)).toContain(AUTOSAVE_SLOT);
  });

  it('names unnamed campaigns after the civilization', () => {
    expect(defaultCampaignName(AUTOSAVE_SLOT, 'Rome')).toBe('Rome — auto');
    expect(defaultCampaignName(MANUAL_SAVE_SLOT, 'Rome')).toBe('Rome — saved');
    expect(defaultCampaignName(AUTOSAVE_SLOT, null)).toBe('Autosave');
  });
});
