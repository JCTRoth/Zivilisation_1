/**
 * IndexedDB implementation of the campaign store.
 *
 * The browser's IndexedDB is the only storage that comfortably holds a
 * multi-megabyte save blob *and* a browsable list of them. `localStorage`
 * has a ~5 MB per-origin quota and a synchronous write API, which is why it
 * is no longer the primary store (see `browserSaveStore.ts`).
 *
 * The implementation is deliberately small and dependency-free: one database,
 * one object store, four operations. Everything else (caching, debouncing,
 * the localStorage fallback) lives in the facade.
 */

import type { CampaignMeta, CampaignStore } from '@shared/ports/campaignStore';

const DB_NAME = 'civ1';
const DB_VERSION = 1;
const STORE_NAME = 'campaigns';

/** One record: the blob plus its metadata, flattened for cheap sorting. */
interface CampaignRecord extends CampaignMeta {
  json: string;
}

/**
 * Open the database, creating the object store on first use.
 *
 * Rejects when IndexedDB is unavailable (private mode, a locked-down kiosk,
 * or a non-browser environment) — the caller falls back to localStorage.
 */
function openCampaignDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IDB_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('IDB_OPEN_BLOCKED'));
  });
}

/**
 * A `CampaignStore` backed by IndexedDB.
 *
 * `factory` is injectable so the store can be exercised against a fake in
 * tests without touching a real browser database.
 */
export function createIndexedDbCampaignStore(factory: IDBFactory): CampaignStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = openCampaignDatabase(factory).catch((error) => {
        // A failed open must not poison the store: the next call retries.
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  };

  const run = async <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await db();
    return new Promise<T>((resolve, reject) => {
      let request: IDBRequest<T>;
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        request = body(transaction.objectStore(STORE_NAME));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      transaction.onabort = () => reject(transaction.error ?? new Error('IDB_TX_ABORTED'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IDB_TX_FAILED'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IDB_REQUEST_FAILED'));
    });
  };

  return {
    async list(): Promise<CampaignMeta[]> {
      const records = await run<CampaignRecord[]>('readonly', (store) => store.getAll());
      return records
        .map(({ json: _json, ...meta }) => meta)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async read(id: string): Promise<string | null> {
      const record = await run<CampaignRecord | undefined>('readonly', (store) => store.get(id));
      return record ? record.json : null;
    },

    async write(id: string, json: string, meta: CampaignMeta): Promise<void> {
      const record: CampaignRecord = { ...meta, id, json };
      await run('readwrite', (store) => store.put(record));
    },

    async remove(id: string): Promise<void> {
      await run('readwrite', (store) => store.delete(id));
    },
  };
}
