/**
 * i18n runtime tests — translation fallback, interpolation, the language
 * switch (persistence + subscribers), dictionary completeness across all
 * shipped languages, and the data-name helpers.
 *
 * The vitest environment is plain node, so `localStorage` / `document` are
 * absent: the runtime must default to English, survive their absence, and
 * honour them once installed (mocked below).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLanguage,
  hasTranslation,
  setLanguage,
  subscribeLanguage,
  t,
  translateDynamic,
} from '@/i18n';
import { en } from '@/i18n/en';
import { de } from '@/i18n/de';
import { fr } from '@/i18n/fr';
import { ru } from '@/i18n/ru';
import { es } from '@/i18n/es';
import { ja } from '@/i18n/ja';
import { DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_STORAGE_KEY, isSupportedLanguage } from '@/i18n/languages';
import { tGovernmentName, tSpecialistName, tTechName, tUnitName, tWonderName } from '@/i18n/dataNames';
import { gameSpeedLabel } from '@/data/GameConstants';

const DICTIONARIES = { en, de, fr, ru, es, ja };
type LanguageCode = keyof typeof DICTIONARIES;

// Minimal localStorage / document stand-ins for the node environment.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const storage = new MemoryStorage();
const htmlElement = { lang: 'en' };

beforeEach(() => {
  storage.clear();
  htmlElement.lang = 'en';
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { documentElement: htmlElement });
  // Every test starts from the default language.
  setLanguage(DEFAULT_LANGUAGE);
});

afterEach(() => {
  setLanguage(DEFAULT_LANGUAGE);
  vi.unstubAllGlobals();
});

describe('translation core', () => {
  it('defaults to English', () => {
    expect(getLanguage()).toBe('en');
    expect(t('menu.settings')).toBe('Settings');
  });

  it('translates known keys per language', () => {
    expect(t('menu.settings')).toBe('Settings');
    setLanguage('de');
    expect(t('menu.settings')).toBe('Einstellungen');
    setLanguage('ja');
    expect(t('menu.settings')).toBe('設定');
  });

  it('interpolates {{placeholders}}', () => {
    expect(t('common.turn', { turn: 12 })).toBe('Turn 12');
    setLanguage('de');
    expect(t('common.turn', { turn: 12 })).toBe('Runde 12');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(t('common.turn', {})).toBe('Turn {{turn}}');
    expect(t('menu.ariaLabel', { title: 'Game' })).toBe('Game menu');
  });

  it('keeps the e2e load-bearing end-turn strings in English', () => {
    // Playwright filters on these exact strings (see EndTurnConfirmModal).
    expect(t('endTurn.titleManual')).toBe('End Turn?');
    expect(t('endTurn.titleAuto')).toBe('All Your Units Have Moved!');
  });
});

describe('language switching', () => {
  it('persists the choice to localStorage', () => {
    setLanguage('fr');
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
  });

  it('updates <html lang> when a document is present', () => {
    setLanguage('ru');
    expect(htmlElement.lang).toBe('ru');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLanguage(listener);
    setLanguage('es');
    expect(listener).toHaveBeenCalledTimes(1);
    setLanguage('es'); // same language — no notification
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLanguage('ja');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores unsupported languages', () => {
    setLanguage('klingon' as never);
    expect(getLanguage()).toBe('en');
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('isSupportedLanguage narrows ids against the registry', () => {
    expect(isSupportedLanguage('de')).toBe(true);
    expect(isSupportedLanguage('xx')).toBe(false);
    expect(isSupportedLanguage(42)).toBe(false);
  });

  it('ships every registry language with a flag, native name and locale', () => {
    for (const language of LANGUAGES) {
      expect(language.nativeName.length).toBeGreaterThan(0);
      expect(language.englishName.length).toBeGreaterThan(0);
      expect(language.flag.length).toBeGreaterThan(0);
      expect(language.locale.length).toBeGreaterThanOrEqual(2);
      // Every registry entry must have a registered dictionary.
      expect(Object.keys(DICTIONARIES)).toContain(language.id);
    }
  });
});

describe('dictionary completeness', () => {
  const baseKeys = Object.keys(en);

  it.each(Object.keys(DICTIONARIES) as LanguageCode[])(
    '%s defines every English key with a non-empty string',
    (code) => {
      const dictionary = DICTIONARIES[code] as Record<string, unknown>;
      for (const key of baseKeys) {
        expect(dictionary[key], `missing translation for "${key}" in ${code}`).toBeTypeOf('string');
        expect((dictionary[key] as string).length, `empty translation for "${key}" in ${code}`).toBeGreaterThan(0);
      }
    },
  );

  it.each(Object.keys(DICTIONARIES).filter((code) => code !== 'en') as LanguageCode[])(
    '%s defines no keys unknown to English',
    (code) => {
      const dictionary = DICTIONARIES[code] as Record<string, unknown>;
      for (const key of Object.keys(dictionary)) {
        expect(en, `unknown key "${key}" in ${code}`).toHaveProperty(key);
      }
    },
  );

  it('non-English languages actually translate the data names', () => {
    // Guards against a language file that copies the English values: the
    // vast majority of unit/building/tech/wonder names must differ.
    const dataKeys = baseKeys.filter((key) => key.startsWith('data.'));
    expect(dataKeys.length).toBeGreaterThan(100);
    for (const code of Object.keys(DICTIONARIES).filter((c) => c !== 'en') as LanguageCode[]) {
      const dictionary = DICTIONARIES[code] as Record<string, string>;
      const translated = dataKeys.filter((key) => dictionary[key] !== en[key as keyof typeof en]);
      expect(translated.length / dataKeys.length, `${code} looks untranslated`).toBeGreaterThan(0.75);
    }
  });

  it('non-English languages actually translate the UI strings', () => {
    // Same guard for the UI namespaces. A few values legitimately equal the
    // English one ('Moderate', 'Prince', 'sci', 'Status:' …), so the allowed
    // share is small but non-zero. Measured today: de 4.5%, fr 5.2%,
    // ru 2.2%, es 3.8%, ja 2.6%.
    const uiKeys = baseKeys.filter((key) => !key.startsWith('data.'));
    expect(uiKeys.length).toBeGreaterThan(1000);
    for (const code of Object.keys(DICTIONARIES).filter((c) => c !== 'en') as LanguageCode[]) {
      const dictionary = DICTIONARIES[code] as Record<string, string>;
      const identical = uiKeys.filter((key) => dictionary[key] === en[key as keyof typeof en]);
      expect(
        identical.length / uiKeys.length,
        `${code} has too many untranslated UI strings (e.g. ${identical.slice(0, 5).join(', ')})`,
      ).toBeLessThan(0.15);
    }
  });
});

describe('dynamic keys and fallbacks', () => {
  it('resolves data keys for the active language', () => {
    expect(translateDynamic('data.unit.settler')).toBe('Settler');
    setLanguage('de');
    expect(translateDynamic('data.unit.settler')).toBe('Siedler');
  });

  it('falls back to the provided fallback for unknown keys', () => {
    expect(translateDynamic('data.unit.time_machine', undefined, 'Time Machine')).toBe('Time Machine');
    // No fallback either: the key itself is returned, never undefined.
    expect(translateDynamic('data.unit.time_machine')).toBe('data.unit.time_machine');
  });

  it('hasTranslation reports dictionary membership', () => {
    expect(hasTranslation('data.wonder.pyramids', 'fr')).toBe(true);
    expect(hasTranslation('data.wonder.pyramids_typo', 'fr')).toBe(false);
  });
});

describe('data name helpers', () => {
  it('translate unit, tech, wonder, government and specialist names', () => {
    setLanguage('de');
    expect(tUnitName('settler', 'Settler')).toBe('Siedler');
    expect(tTechName('pottery', 'Pottery')).toBe('Keramik');
    expect(tWonderName('pyramids', 'Pyramids')).toBe('Pyramiden');
    expect(tGovernmentName('democracy', 'Democracy')).toBe('Demokratie');
    expect(tSpecialistName('scientist', 'Scientist')).toBe('Wissenschaftler');
  });

  it('falls back to the English display name for unknown ids', () => {
    expect(tUnitName('hovercraft', 'Hovercraft')).toBe('Hovercraft');
    expect(tUnitName('hovercraft', 'Hovercraft')).not.toBe('data.unit.hovercraft');
  });

  it('gameSpeedLabel follows the active language', () => {
    expect(gameSpeedLabel(0)).toBe('Full Speed');
    expect(gameSpeedLabel(2)).toBe('Slower ×2');
    setLanguage('ja');
    expect(gameSpeedLabel(0)).toBe('フルスピード');
    expect(gameSpeedLabel(2)).toBe('×2 遅く');
  });
});

describe('game store integration', () => {
  it('updateSettings({ language }) switches the i18n runtime', async () => {
    const { useGameStore } = await import('@/stores/GameStore');
    useGameStore.getState().actions.updateSettings({ language: 'ja' });
    expect(getLanguage()).toBe('ja');
    expect(useGameStore.getState().settings.language).toBe('ja');
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ja');
  });

  it('a fresh boot restores the persisted language into the store defaults', async () => {
    // Simulate a page reload: persisted choice on disk, fresh module registry.
    storage.setItem(LANGUAGE_STORAGE_KEY, 'ru');
    vi.resetModules();
    const fresh = await import('@/stores/GameStore');
    expect(fresh.useGameStore.getState().settings.language).toBe('ru');
  });
});
