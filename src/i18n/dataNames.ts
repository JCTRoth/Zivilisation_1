/**
 * Translation helpers for game *data* names (units, buildings, technologies,
 * wonders, governments, specialists).
 *
 * The data tables in `src/data/*` keep English display names as their
 * fallback, so untranslated ids and modded content still render. Every helper
 * maps the stable id (`'warrior'`, `'barracks'`, `'pottery'`, …) to the
 * `data.<kind>.<id>` key in the active language.
 *
 * Components using these helpers should call `useTranslation()` once at the
 * top so they re-render on a language switch.
 */
import { translateDynamic } from './index';

const tName = (kind: string, id: string, fallback: string): string =>
  translateDynamic(`data.${kind}.${id}`, undefined, fallback);

/** Localized unit name, e.g. `tUnitName('settler', 'Settler')` → 'Siedler' (de). */
export const tUnitName = (id: string, fallback: string): string => tName('unit', id, fallback);

/** Localized building name. */
export const tBuildingName = (id: string, fallback: string): string => tName('building', id, fallback);

/** Localized technology name. */
export const tTechName = (id: string, fallback: string): string => tName('tech', id, fallback);

/** Localized wonder name. */
export const tWonderName = (id: string, fallback: string): string => tName('wonder', id, fallback);

/** Localized government name. */
export const tGovernmentName = (id: string, fallback: string): string => tName('government', id, fallback);

/** Localized specialist name. */
export const tSpecialistName = (id: string, fallback: string): string => tName('specialist', id, fallback);
