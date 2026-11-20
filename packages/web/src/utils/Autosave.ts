/**
 * Metadata of the campaign the War Council can resume.
 *
 * The engine keeps two browser slots: `civ1_savegame` (manual save) and
 * `civ1_autosave` (written at the end of every turn). The council prefers the
 * autosave — that is where the player actually left off — and falls back to
 * the manual slot. Reading is defensive: a corrupt blob must never keep the
 * menu from opening.
 */
export interface AutosaveMeta {
  slot: 'civ1_autosave' | 'civ1_savegame';
  civilizationName: string | null;
  turn: number;
  year: number;
}

interface SaveBlob {
  currentTurn?: number;
  currentYear?: number;
  humanCivId?: number;
  gameSettings?: { humanPlayerIds?: number[] };
  civilizations?: Array<{ id?: number; name?: string; isHuman?: boolean }>;
}

function parseMeta(json: string, slot: AutosaveMeta['slot']): AutosaveMeta | null {
  try {
    const data = JSON.parse(json) as SaveBlob;
    if (!data || typeof data !== 'object') return null;
    const civilizations = Array.isArray(data.civilizations) ? data.civilizations : [];
    const humanId = data.humanCivId
      ?? data.gameSettings?.humanPlayerIds?.[0]
      ?? civilizations.find((civ) => civ.isHuman)?.id;
    const civ = civilizations.find((entry) => entry.id === humanId) ?? civilizations[0];
    return {
      slot,
      civilizationName: typeof civ?.name === 'string' ? civ.name : null,
      turn: Number.isFinite(data.currentTurn) ? Number(data.currentTurn) : 1,
      year: Number.isFinite(data.currentYear) ? Number(data.currentYear) : -4000,
    };
  } catch {
    return null;
  }
}

/** Read the resumable campaign, or null when neither slot holds a save. */
export function readAutosaveMeta(): AutosaveMeta | null {
  try {
    const autosave = globalThis.localStorage?.getItem('civ1_autosave');
    if (autosave) {
      const meta = parseMeta(autosave, 'civ1_autosave');
      if (meta) return meta;
    }
    const manual = globalThis.localStorage?.getItem('civ1_savegame');
    return manual ? parseMeta(manual, 'civ1_savegame') : null;
  } catch {
    return null;
  }
}
