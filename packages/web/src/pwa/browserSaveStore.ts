/**
 * The browser's save store — a synchronous `SaveStore` facade over the
 * asynchronous campaign library.
 *
 * Why a facade and not a direct IndexedDB store?
 *
 * `GameEngine.saveGame()` and `loadGame()` are synchronous-by-design (the
 * server writes to SQLite through the same synchronous port). IndexedDB is
 * asynchronous. Rather than change the engine's contract — and with it the
 * server, the rooms and three thousand tests — this facade keeps a
 * synchronous in-memory map as the engine-facing surface and writes through
 * to IndexedDB in the background.
 *
 * The engine therefore keeps calling `saveGame('civ1_autosave')` and
 * `loadGame('civ1_savegame')` and never learns that the browser grew a
 * campaign library underneath it.
 *
 * Storage tiers:
 *   1. IndexedDB  — the campaign library. Async, no size cliff, many slots.
 *   2. localStorage — the fallback when IndexedDB is unavailable (private
 *      mode, locked-down kiosk) and the migration source for legacy saves.
 */

import {
  AUTOSAVE_SLOT,
  MANUAL_SAVE_SLOT,
  createMemoryCampaignStore,
  type CampaignKind,
  type CampaignMeta,
  type CampaignStore,
} from '@shared/ports/campaignStore';
import type { SaveStore } from '@shared/ports/saveStore';
import { CURRENT_SAVE_VERSION, readSaveMetadata } from '@shared/types/saves';
import { createIndexedDbCampaignStore } from './indexedDbCampaignStore';

/** Which tier is currently backing the store. */
type BrowserSaveStoreMode = 'indexeddb' | 'localstorage';

/** How long a write waits for more writes before it is flushed. */
const SAVE_FLUSH_DELAY_MS = 250;

/** The engine's own slots — the ones `GameEngine` writes today. */
const LEGACY_SLOTS = [MANUAL_SAVE_SLOT, AUTOSAVE_SLOT] as const;

export interface BrowserSaveStoreOptions {
  /** IndexedDB factory. `null` forces the localStorage tier. */
  factory?: IDBFactory | null;
  /** The `Storage` used for the fallback tier and the legacy migration. */
  storage?: Storage | null;
  /** Clock injection point for deterministic tests. */
  now?: () => number;
  /** Debounce window for the write-through. */
  flushDelayMs?: number;
}

export interface BrowserSaveStore extends SaveStore {
  /** Which tier is backing the store right now. */
  readonly mode: BrowserSaveStoreMode;
  /** Load the persisted campaigns into memory. Call once before the first load. */
  hydrate(): Promise<void>;
  /** Write every pending change immediately. */
  flush(): Promise<void>;
  /** Every known campaign, newest first. */
  listCampaigns(): Promise<CampaignMeta[]>;
  /** The JSON blob of one campaign. */
  readCampaign(id: string): Promise<string | null>;
  /** Write one campaign and return its metadata. */
  writeCampaign(id: string, json: string, overrides?: Partial<CampaignMeta>): Promise<CampaignMeta>;
  /** Delete one campaign. */
  removeCampaign(id: string): Promise<void>;
  /** Synchronous metadata lookup (null until `hydrate()` has run). */
  campaignMeta(id: string): CampaignMeta | null;
}

/** localStorage-backed `CampaignStore` — tier 2. */
function createLocalStorageCampaignStore(storage: Storage): CampaignStore {
  const META_SUFFIX = '::meta';
  const metaKey = (id: string) => `${id}${META_SUFFIX}`;
  const readMeta = (id: string): CampaignMeta | null => {
    try {
      const raw = storage.getItem(metaKey(id));
      return raw ? (JSON.parse(raw) as CampaignMeta) : null;
    } catch {
      return null;
    }
  };
  return {
    async list(): Promise<CampaignMeta[]> {
      const metas: CampaignMeta[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key || !key.endsWith(META_SUFFIX)) continue;
        const meta = readMeta(key.slice(0, -META_SUFFIX.length));
        if (meta) metas.push(meta);
      }
      return metas.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async read(id: string): Promise<string | null> {
      try {
        return storage.getItem(id);
      } catch {
        return null;
      }
    },
    async write(id: string, json: string, meta: CampaignMeta): Promise<void> {
      try {
        storage.setItem(id, json);
        storage.setItem(metaKey(id), JSON.stringify(meta));
      } catch (error) {
        // A quota error must not take the game down; the campaign simply is
        // not persisted.
        console.warn('[saveStore] localStorage write failed:', error);
      }
    },
    async remove(id: string): Promise<void> {
      try {
        storage.removeItem(id);
        storage.removeItem(metaKey(id));
      } catch {
        /* ignore */
      }
    },
  };
}

/** Derive campaign metadata from a save blob. */
function metaFromBlob(
  id: string,
  json: string,
  now: number,
  overrides: Partial<CampaignMeta> = {},
): CampaignMeta {
  const parsed = readSaveMetadata(json);
  const kind: CampaignKind = overrides.kind ?? (id === AUTOSAVE_SLOT ? 'autosave' : 'manual');
  return {
    id,
    name: overrides.name ?? defaultCampaignName(id, parsed?.civilizationName ?? null),
    turn: overrides.turn ?? parsed?.turn ?? 1,
    year: overrides.year ?? parsed?.year ?? -4000,
    civilizationName: overrides.civilizationName ?? parsed?.civilizationName ?? null,
    updatedAt: overrides.updatedAt ?? now,
    sizeBytes: overrides.sizeBytes ?? json.length,
    version: overrides.version ?? parsed?.version ?? CURRENT_SAVE_VERSION,
    kind,
  };
}

/** A readable default name for a campaign that the player did not name. */
export function defaultCampaignName(id: string, civilizationName: string | null): string {
  if (id === AUTOSAVE_SLOT) return civilizationName ? `${civilizationName} — auto` : 'Autosave';
  if (id === MANUAL_SAVE_SLOT) return civilizationName ? `${civilizationName} — saved` : 'Saved game';
  return civilizationName ? `${civilizationName} — ${id.slice(0, 8)}` : id;
}

/** True when a storage error means "the disk is full". */
function isQuotaError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name;
  if (name === 'QuotaExceededError') return true;
  const message = String((error as { message?: string }).message ?? error).toLowerCase();
  return message.includes('quota');
}

/**
 * The event the store fires when it has to fall back to the smaller tier.
 *
 * The UI listens for it so the player learns that saves are now limited
 * instead of silently losing them.
 */
export const SAVE_STORE_FALLBACK_EVENT = 'civ1:save-store-fallback';

function announceFallback(): void {
  try {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(SAVE_STORE_FALLBACK_EVENT));
  } catch {
    /* the UI is optional */
  }
}

/**
 * Build the browser save store.
 *
 * The store starts in `localstorage` mode and promotes itself to `indexeddb`
 * as soon as `hydrate()` proves the database is usable. Nothing is written
 * before the store is hydrated, so a game never starts against a half-loaded
 * library.
 */
export function createBrowserSaveStore(options: BrowserSaveStoreOptions = {}): BrowserSaveStore {
  const now = options.now ?? (() => Date.now());
  const flushDelayMs = options.flushDelayMs ?? SAVE_FLUSH_DELAY_MS;
  const storage: Storage | null =
    options.storage !== undefined ? options.storage : getDefaultStorage();
  const factory: IDBFactory | null =
    options.factory !== undefined ? options.factory : getDefaultIdbFactory();

  const memory = new Map<string, string>();
  const metas = new Map<string, CampaignMeta>();
  const dirty = new Set<string>();
  // Keys written while the library was still loading. Their in-memory value
  // is newer than the persisted one, so the hydration must not overwrite it.
  const writtenDuringHydrate = new Set<string>();
  let backend: CampaignStore = createMemoryCampaignStore();
  let mode: BrowserSaveStoreMode = 'localstorage';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> = Promise.resolve();
  let hydratePromise: Promise<void> | null = null;

  const scheduleFlush = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flushInternal();
    }, flushDelayMs);
  };

  const flushInternal = async (): Promise<void> => {
    // Never write before the real backend is known — a flush that lands in
    // the in-memory fallback would silently drop the campaign.
    await hydrate();
    if (dirty.size === 0) return;
    const ids = [...dirty];
    dirty.clear();
    for (const id of ids) {
      const json = memory.get(id);
      if (json === undefined) continue;
      const meta = metas.get(id) ?? metaFromBlob(id, json, now());
      metas.set(id, meta);
      try {
        await backend.write(id, json, meta);
      } catch (error) {
        if (mode === 'indexeddb' && storage && isQuotaError(error)) {
          // The device is full. Fall back to the smaller tier so the game
          // keeps saving, and tell the player that the limit is now lower.
          console.warn('[saveStore] storage quota exceeded — falling back to localStorage');
          backend = createLocalStorageCampaignStore(storage);
          mode = 'localstorage';
          announceFallback();
          try {
            await backend.write(id, json, meta);
            continue;
          } catch (fallbackError) {
            console.warn(`[saveStore] could not persist campaign "${id}":`, fallbackError);
            dirty.add(id);
            continue;
          }
        }
        console.warn(`[saveStore] could not persist campaign "${id}":`, error);
        // Put the key back so the next flush retries it.
        dirty.add(id);
      }
    }
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = pending.then(flushInternal, flushInternal);
    await pending;
  };

  /**
   * Load the persisted campaigns into the synchronous surface.
   *
   * Idempotent and safe to call concurrently: the first call wins and every
   * later caller awaits the same promise.
   */
  const hydrate = async (): Promise<void> => {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      if (factory) {
        try {
          const idbStore = createIndexedDbCampaignStore(factory);
          // Prove the database works before committing to it.
          await idbStore.list();
          backend = idbStore;
          mode = 'indexeddb';
        } catch (error) {
          console.warn('[saveStore] IndexedDB unavailable, falling back to localStorage:', error);
          backend = storage ? createLocalStorageCampaignStore(storage) : createMemoryCampaignStore();
          mode = 'localstorage';
        }
      } else {
        backend = storage ? createLocalStorageCampaignStore(storage) : createMemoryCampaignStore();
        mode = 'localstorage';
      }

      // Load the persisted campaigns into the synchronous surface.
      for (const meta of await backend.list()) {
        // A write that happened while the library was loading is newer than
        // what is on disk — keep it.
        if (writtenDuringHydrate.has(meta.id)) continue;
        const json = await backend.read(meta.id);
        if (json === null) continue;
        memory.set(meta.id, json);
        metas.set(meta.id, meta);
      }

      await migrateLegacySlots();
    })();
    return hydratePromise;
  };

  const store: BrowserSaveStore = {
    get mode() {
      return mode;
    },

    get(key: string): string | null {
      return memory.get(key) ?? null;
    },

    set(key: string, value: string): void {
      memory.set(key, value);
      // While the library is still loading this write is newer than what is
      // on disk — remember it so the hydration does not roll it back.
      if (hydratePromise) writtenDuringHydrate.add(key);
      const previous = metas.get(key);
      metas.set(
        key,
        metaFromBlob(key, value, now(), previous ? { ...previous, updatedAt: now() } : {}),
      );
      dirty.add(key);
      if (key === AUTOSAVE_SLOT) {
        // The autosave is written every turn — debounce it so a burst of
        // writes costs one transaction.
        scheduleFlush();
      } else {
        // A deliberate save must reach the disk *now*: the player may close
        // the tab immediately afterwards, and a pending write would be lost.
        void flush();
      }
    },

    hydrate,

    flush,

    async listCampaigns(): Promise<CampaignMeta[]> {
      await hydrate();
      const stored = await backend.list();
      const byId = new Map<string, CampaignMeta>();
      for (const meta of stored) byId.set(meta.id, meta);
      // A campaign written but not yet flushed still belongs in the list.
      for (const [id, meta] of metas) byId.set(id, meta);
      return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async readCampaign(id: string): Promise<string | null> {
      await hydrate();
      return backend.read(id);
    },

    async writeCampaign(id: string, json: string, overrides: Partial<CampaignMeta> = {}): Promise<CampaignMeta> {
      await hydrate();
      const meta = metaFromBlob(id, json, now(), {
        ...overrides,
        updatedAt: overrides.updatedAt ?? now(),
      });
      memory.set(id, json);
      metas.set(id, meta);
      dirty.add(id);
      await flush();
      return meta;
    },

    async removeCampaign(id: string): Promise<void> {
      await hydrate();
      memory.delete(id);
      metas.delete(id);
      dirty.delete(id);
      try {
        await backend.remove(id);
      } catch (error) {
        console.warn(`[saveStore] could not remove campaign "${id}":`, error);
      }
      if (storage) {
        try {
          storage.removeItem(id);
          storage.removeItem(`${id}::meta`);
        } catch {
          /* ignore */
        }
      }
    },

    campaignMeta(id: string): CampaignMeta | null {
      return metas.get(id) ?? null;
    },
  };

  /**
   * Move a legacy `localStorage` save into the campaign library.
   *
   * In the IndexedDB tier the legacy key is deleted only after the campaign
   * is safely stored, so a failed write never destroys the only copy of a
   * campaign. In the localStorage tier the legacy key *is* the live key —
   * it must not be removed.
   */
  async function migrateLegacySlots(): Promise<void> {
    if (!storage) return;
    for (const slot of LEGACY_SLOTS) {
      if (memory.has(slot)) continue;
      let json: string | null = null;
      try {
        json = storage.getItem(slot);
      } catch {
        continue;
      }
      if (!json) continue;
      const meta = metaFromBlob(slot, json, now());
      try {
        await backend.write(slot, json, meta);
        memory.set(slot, json);
        metas.set(slot, meta);
        if (mode === 'indexeddb') {
          // Only now is it safe to drop the legacy copy.
          storage.removeItem(slot);
        }
      } catch (error) {
        console.warn(`[saveStore] could not migrate legacy slot "${slot}":`, error);
      }
    }
  }

  return store;
}

function getDefaultStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate ?? null;
  } catch {
    // Accessing localStorage throws in some privacy modes.
    return null;
  }
}

function getDefaultIdbFactory(): IDBFactory | null {
  try {
    const candidate = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/**
 * The application-wide save store.
 *
 * A single instance is shared by the whole tab so that the engine, the
 * campaign panel and the autosave metadata all see the same library.
 */
let sharedStore: BrowserSaveStore | null = null;

export function getBrowserSaveStore(): BrowserSaveStore {
  if (!sharedStore) sharedStore = createBrowserSaveStore();
  return sharedStore;
}

/** Replace the shared store — used by tests. */
export function setBrowserSaveStore(store: BrowserSaveStore | null): void {
  sharedStore = store;
}

/**
 * Flush pending writes when the tab is being hidden or closed.
 *
 * The write-through is debounced, so a player who closes the tab right after
 * a turn could otherwise lose that turn's autosave. IndexedDB writes started
 * during `pagehide` are not guaranteed to finish, which is why the flush is
 * also triggered on `visibilitychange` — the browser gives a hidden page a
 * little more time.
 */
export function installPageHideFlush(store: BrowserSaveStore = getBrowserSaveStore()): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
  const flush = () => {
    void store.flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
  };
}
