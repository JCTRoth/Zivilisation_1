/**
 * React binding for the i18n core.
 *
 * `useTranslation()` subscribes the component to language changes through
 * `useSyncExternalStore`, so every component that renders translated text
 * re-renders the moment the player picks another language — no provider, no
 * context, no prop drilling. Components whose *data* is translated through
 * the `dataNames` helpers (unit/building/tech names …) call this hook too,
 * purely for that re-render subscription.
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  formatNumber,
  formatPercent,
  getLanguage,
  setLanguage,
  subscribeLanguage,
  t,
} from './index';
import { DEFAULT_LANGUAGE, LANGUAGES, getLanguageDefinition, type LanguageDefinition, type LanguageId } from './languages';

export interface UseTranslationResult {
  /** Translate a key in the active language: `t('menu.settings')`. */
  t: typeof t;
  /** The active language id. */
  language: LanguageId;
  /** Switch the language (persists the choice, notifies subscribers). */
  setLanguage: (language: LanguageId) => void;
  /** Every shipped language, in switcher order. */
  languages: readonly LanguageDefinition[];
  /** Definition (native name, flag, locale …) of the active language. */
  languageDefinition: LanguageDefinition;
  formatNumber: typeof formatNumber;
  formatPercent: typeof formatPercent;
}

export function useTranslation(): UseTranslationResult {
  const language = useSyncExternalStore(
    subscribeLanguage,
    getLanguage,
    () => DEFAULT_LANGUAGE,
  );

  const setLanguageCallback = useCallback((next: LanguageId) => setLanguage(next), []);

  return {
    t,
    language,
    setLanguage: setLanguageCallback,
    languages: LANGUAGES,
    languageDefinition: getLanguageDefinition(language),
    formatNumber,
    formatPercent,
  };
}
