/**
 * Storage port for save/load. The engine must never import `localStorage`
 * directly: the browser provides a localStorage-backed store, a server room
 * provides an in-memory (or database) store, and node tests can provide a stub.
 *
 * The v4 save blob and the v1–v4 migrations in GameEngine are already portable;
 * this interface is the only browser coupling left in that path.
 */
export interface SaveStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Default for the in-tab browser engine. Safe in node (returns null). */
export const browserSaveStore: SaveStore = {
  get: (key) => globalThis.localStorage?.getItem(key) ?? null,
  set: (key, value) => {
    globalThis.localStorage?.setItem(key, value);
  },
};
