/**
 * Language registry — the single place that defines which languages the game
 * ships with. This file has no imports on purpose so it can be used from the
 * data layer, the store and the UI alike.
 *
 * ── Adding a new language ─────────────────────────────────────────────────
 * 1. Create `src/i18n/<id>.ts` exporting the translations (copy `en.ts` and
 *    translate the values; every key is type-checked).
 * 2. Add the id to `LanguageId` below.
 * 3. Add a `LanguageDefinition` entry to `LANGUAGES` (native name, English
 *    name, flag, BCP-47 locale).
 * 4. Register the dictionary in `DICTIONARIES` inside `src/i18n/index.ts`.
 * See `doc/I18N.adoc` for the full walkthrough.
 */

/** localStorage key under which the player's language choice is persisted. */
export const LANGUAGE_STORAGE_KEY = 'civ1_language';

/** Ids of every shipped language. Extend when adding a language (see above). */
export type LanguageId = 'en' | 'de' | 'fr' | 'ru' | 'es' | 'ja';

export interface LanguageDefinition {
  /** Stable id, also used as the `<html lang>` value and storage value. */
  id: LanguageId;
  /** Name of the language *in that language* — what the player picks by. */
  nativeName: string;
  /** Name of the language in English, for players who don't read the native name. */
  englishName: string;
  /** Flag shown on the language switch card. */
  flag: string;
  /** BCP-47 tag handed to Intl for number/date formatting. */
  locale: string;
}

/** Fallback language. English is the source of truth for every key. */
export const DEFAULT_LANGUAGE: LanguageId = 'en';

/** Every shipped language, in the order shown by the language switcher. */
export const LANGUAGES: readonly LanguageDefinition[] = [
  { id: 'en', nativeName: 'English', englishName: 'English', flag: '🇬🇧', locale: 'en' },
  { id: 'de', nativeName: 'Deutsch', englishName: 'German', flag: '🇩🇪', locale: 'de' },
  { id: 'fr', nativeName: 'Français', englishName: 'French', flag: '🇫🇷', locale: 'fr' },
  { id: 'ru', nativeName: 'Русский', englishName: 'Russian', flag: '🇷🇺', locale: 'ru' },
  { id: 'es', nativeName: 'Español', englishName: 'Spanish', flag: '🇪🇸', locale: 'es' },
  { id: 'ja', nativeName: '日本語', englishName: 'Japanese', flag: '🇯🇵', locale: 'ja' },
];

const LANGUAGE_BY_ID: Record<string, LanguageDefinition> = Object.fromEntries(
  LANGUAGES.map((language) => [language.id, language]),
);

/** Narrow an arbitrary value (e.g. a stored string) to a supported language id. */
export function isSupportedLanguage(value: unknown): value is LanguageId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_BY_ID, value);
}

/** Definition of a language, falling back to English for unknown ids. */
export function getLanguageDefinition(id: string): LanguageDefinition {
  return LANGUAGE_BY_ID[id] ?? LANGUAGE_BY_ID[DEFAULT_LANGUAGE];
}
