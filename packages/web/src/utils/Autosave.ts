/**
 * Metadata of the campaign the War Council can resume.
 *
 * The engine keeps two browser slots: `civ1_savegame` (manual save) and
 * `civ1_autosave` (written at the end of every turn). Both now live in the
 * campaign library (IndexedDB with a localStorage fallback — see
 * `packages/web/src/pwa/browserSaveStore.ts`).
 *
 * Reading is defensive: a corrupt blob must never keep the menu from opening,
 * and an unavailable store must never break the boot.
 */
import { AUTOSAVE_SLOT, MANUAL_SAVE_SLOT } from '@shared/ports/campaignStore';
import { getBrowserSaveStore } from '../pwa/browserSaveStore';

export interface AutosaveMeta {
  slot: 'civ1_autosave' | 'civ1_savegame';
  civilizationName: string | null;
  turn: number;
  year: number;
  /** Epoch millis of the last write, when known. */
  updatedAt?: number;
}

/**
 * Read the resumable campaign from the in-memory metadata cache.
 *
 * Synchronous by design: the War Council renders on the first paint. The
 * cache is empty until the store has been hydrated, so callers that need a
 * guaranteed answer use {@link readAutosaveMetaAsync}.
 */
export function readAutosaveMeta(): AutosaveMeta | null {
  try {
    const store = getBrowserSaveStore();
    const autosave = store.campaignMeta(AUTOSAVE_SLOT);
    if (autosave) return toMeta(AUTOSAVE_SLOT, autosave);
    const manual = store.campaignMeta(MANUAL_SAVE_SLOT);
    if (manual) return toMeta(MANUAL_SAVE_SLOT, manual);
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the resumable campaign after the campaign library is loaded.
 *
 * The autosave slot wins over the manual slot — that is where the player
 * actually left off.
 */
export async function readAutosaveMetaAsync(): Promise<AutosaveMeta | null> {
  try {
    const store = getBrowserSaveStore();
    await store.hydrate();
    const autosave = store.campaignMeta(AUTOSAVE_SLOT);
    if (autosave) return toMeta(AUTOSAVE_SLOT, autosave);
    const manual = store.campaignMeta(MANUAL_SAVE_SLOT);
    if (manual) return toMeta(MANUAL_SAVE_SLOT, manual);
    return null;
  } catch {
    return null;
  }
}

function toMeta(
  slot: AutosaveMeta['slot'],
  meta: { civilizationName: string | null; turn: number; year: number; updatedAt: number },
): AutosaveMeta {
  return {
    slot,
    civilizationName: meta.civilizationName,
    turn: meta.turn,
    year: meta.year,
    updatedAt: meta.updatedAt,
  };
}
