/**
 * CAMPAIGN STORE PORT — the local campaign library.
 *
 * `SaveStore` (see `saveStore.ts`) is the engine's *slot* API: one key, one
 * JSON blob, synchronous. That is exactly what `GameEngine.saveGame()` and
 * `loadGame()` need and it stays unchanged.
 *
 * A *campaign library* is a different thing: a browsable list of named
 * campaigns, each with metadata (turn, year, civilization, date, size), able
 * to hold megabyte-sized blobs and to grow without a hard quota cliff.
 * IndexedDB is the natural browser implementation; the interface is
 * asynchronous because the storage is.
 *
 * The port lives in `shared` so both the web client and — later — a server
 * adapter can implement it without either side importing the other.
 */

/** Where a campaign came from. `manual` is player-named, `autosave` is the engine's own slot. */
export type CampaignKind = 'manual' | 'autosave';

/** Everything the campaign list needs to render a row — no blob required. */
export interface CampaignMeta {
  /** Stable identifier. The engine's own slots use `civ1_savegame` / `civ1_autosave`. */
  id: string;
  /** Player-visible name. Defaults to a generated label for autosaves. */
  name: string;
  /** Game turn at the time of the save. */
  turn: number;
  /** In-game year at the time of the save. */
  year: number;
  /** Name of the civilization the player was playing, when known. */
  civilizationName: string | null;
  /** Epoch millis of the last write. */
  updatedAt: number;
  /** Size of the JSON blob in bytes. */
  sizeBytes: number;
  /** Save format version of the blob. */
  version: number;
  /** Manual or autosave. */
  kind: CampaignKind;
}

/**
 * The asynchronous campaign library.
 *
 * Implementations must be tolerant of a missing/unavailable backing store:
 * `list()` returns an empty list, `read()` returns null, `write()` rejects.
 */
export interface CampaignStore {
  /** Every known campaign, newest first. */
  list(): Promise<CampaignMeta[]>;
  /** The JSON blob of one campaign, or null when it does not exist. */
  read(id: string): Promise<string | null>;
  /** Write (or overwrite) one campaign. */
  write(id: string, json: string, meta: CampaignMeta): Promise<void>;
  /** Delete one campaign. Removing a missing id is not an error. */
  remove(id: string): Promise<void>;
}

/** The engine's own slots — the two keys `GameEngine` writes today. */
export const MANUAL_SAVE_SLOT = 'civ1_savegame';
export const AUTOSAVE_SLOT = 'civ1_autosave';

/** In-memory implementation — used by node tests and as the last-resort fallback. */
export function createMemoryCampaignStore(): CampaignStore & { data: Map<string, { json: string; meta: CampaignMeta }> } {
  const data = new Map<string, { json: string; meta: CampaignMeta }>();
  return {
    data,
    async list(): Promise<CampaignMeta[]> {
      return [...data.values()]
        .map((entry) => entry.meta)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async read(id: string): Promise<string | null> {
      return data.get(id)?.json ?? null;
    },
    async write(id: string, json: string, meta: CampaignMeta): Promise<void> {
      data.set(id, { json, meta });
    },
    async remove(id: string): Promise<void> {
      data.delete(id);
    },
  };
}
