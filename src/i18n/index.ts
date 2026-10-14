/**
 * i18n core — a dependency-free translation runtime for the game.
 *
 * Design notes:
 *  - English (`en.ts`) is the source of truth; every other dictionary is
 *    partial and falls back to English per key, so a half-finished
 *    translation still renders sensible text instead of raw keys.
 *  - The active language lives in module state, is persisted to localStorage
 *    (`civ1_language`) and is exposed to React through `useSyncExternalStore`
 *    (see `useTranslation.ts`) — no provider needed, the whole tree can call
 *    `t()` directly.
 *  - `localStorage` and `document` are touched defensively: the vitest
 *    environment is plain node and storage can be blocked in the browser.
 */
import { en, type TranslationKey, type PartialTranslationDict } from './en';
import { de } from './de';
import { fr } from './fr';
import { ru } from './ru';
import { es } from './es';
import { ja } from './ja';
import {
  LANGUAGE_STORAGE_KEY,
  getLanguageDefinition,
  isSupportedLanguage,
  type LanguageId,
} from './languages';
import { detectBrowserLanguage } from './languageDetection';

export type { LanguageId } from './languages';
export type { TranslationKey } from './en';

/** Registered dictionaries. Adding a language = one entry here (see doc/I18N.adoc). */
const DICTIONARIES: Record<LanguageId, PartialTranslationDict> = { en, de, fr, ru, es, ja };

/** Values accepted for `{{placeholder}}` interpolation. */
export type TranslationParams = Record<string, string | number>;

let currentLanguage: LanguageId = readInitialLanguage();
const listeners = new Set<() => void>();

/**
 * Resolve the language the game starts in.
 *
 * A choice the player made beats everything — the browser's opinion only
 * counts while there is nothing stored. That ordering matters: a player who
 * deliberately switched away from their browser language must never have it
 * switched back on the next load.
 */
function readInitialLanguage(): LanguageId {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupportedLanguage(stored)) {
      return stored;
    }
  } catch {
    // Storage unavailable (private mode, blocked cookies, node tests) — fall
    // through to the browser's guess.
  }
  return detectBrowserLanguage();
}

/** The active language id. */
export function getLanguage(): LanguageId {
  return currentLanguage;
}

/** BCP-47 locale of the active language, for Intl formatters. */
function getLocale(): string {
  return getLanguageDefinition(currentLanguage).locale;
}

/** Switch the game language: persists the choice and re-renders subscribers. */
export function setLanguage(language: LanguageId): void {
  if (!isSupportedLanguage(language) || language === currentLanguage) {
    return;
  }
  currentLanguage = language;
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persisting is best-effort; the in-memory switch still applies.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fill `{{placeholders}}`; unknown placeholders are left untouched. */
function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Translate a known key in the active language — the function components use
 * on every render, usually via the `useTranslation()` hook.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = DICTIONARIES[currentLanguage][key] ?? en[key];
  return interpolate(template, params);
}

/**
 * Translate a key assembled at runtime (data names), e.g. `data.unit.warrior`.
 * Falls back active language → English → `fallback` → the key itself.
 */
export function translateDynamic(key: string, params?: TranslationParams, fallback?: string): string {
  const active = DICTIONARIES[currentLanguage] as Record<string, string | undefined>;
  const template = active[key] ?? (en as Record<string, string | undefined>)[key] ?? fallback ?? key;
  return interpolate(template, params);
}

/** Whether a dictionary defines a key (used by tests and tooling). */
export function hasTranslation(key: string, language: LanguageId = currentLanguage): boolean {
  const dictionary = DICTIONARIES[language] as Record<string, string | undefined>;
  return typeof dictionary[key] === 'string';
}

/** Number formatting in the active locale (1.234,5 vs 1,234.5). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(getLocale(), options).format(value);
  } catch {
    return String(value);
  }
}

/** Percentage formatting in the active locale. */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  return formatNumber(ratio * 100, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

// Keep `<html lang>` truthful from the very first paint.
if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLanguage;
}
