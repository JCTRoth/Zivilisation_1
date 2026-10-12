/**
 * Wonder-lore localization tests — every shipped language must carry the full
 * translated prose of every wonder (effect, flavour, about paragraph and the
 * fact bullets, in the same order and count as the English data), and the
 * Wikipedia links must point at the player's language.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WONDERS } from '@/data/WonderData';
import {
  WONDER_WIKI_TITLES,
  getWonderLore,
  localizedWonder,
  wonderWikiUrl,
} from '@/i18n/wonderLore';
import { DEFAULT_LANGUAGE, type LanguageId } from '@/i18n/languages';
import { setLanguage } from '@/i18n';
import wonderLoreDe from '@/i18n/wonderLore/de';
import wonderLoreFr from '@/i18n/wonderLore/fr';
import wonderLoreRu from '@/i18n/wonderLore/ru';
import wonderLoreEs from '@/i18n/wonderLore/es';
import wonderLoreJa from '@/i18n/wonderLore/ja';

const SHIPPED: Record<string, Record<string, ReturnType<typeof getWonderLore>>> = {
  de: wonderLoreDe,
  fr: wonderLoreFr,
  ru: wonderLoreRu,
  es: wonderLoreEs,
  ja: wonderLoreJa,
};

beforeEach(() => setLanguage(DEFAULT_LANGUAGE));
afterEach(() => setLanguage(DEFAULT_LANGUAGE));

describe('wonder lore completeness', () => {
  it.each(Object.keys(SHIPPED))('%s translates every wonder fully', (code) => {
    const lore = SHIPPED[code];
    for (const wonder of WONDERS) {
      const entry = lore[wonder.id];
      expect(entry, `${code}: missing wonder "${wonder.id}"`).toBeDefined();
      for (const field of ['shortEffect', 'effectText', 'flavor'] as const) {
        const value = entry![field];
        expect(typeof value, `${code}/${wonder.id}.${field} missing`).toBe('string');
        expect((value as string).length, `${code}/${wonder.id}.${field} empty`).toBeGreaterThan(0);
      }
      if (wonder.about) {
        expect(typeof entry!.about, `${code}/${wonder.id}.about missing`).toBe('string');
        expect((entry!.about as string).length).toBeGreaterThan(0);
      }
      expect(Array.isArray(entry!.facts), `${code}/${wonder.id}.facts missing`).toBe(true);
      expect(
        entry!.facts!.length,
        `${code}/${wonder.id}: fact count differs from English (${wonder.facts.length})`,
      ).toBe(wonder.facts.length);
      for (const [i, fact] of entry!.facts!.entries()) {
        expect(fact.length, `${code}/${wonder.id}.facts[${i}] empty`).toBeGreaterThan(0);
      }
    }
  });

  it.each(Object.keys(SHIPPED))('%s actually translates the prose (not English copies)', (code) => {
    const lore = SHIPPED[code];
    let translated = 0;
    let total = 0;
    for (const wonder of WONDERS) {
      const entry = lore[wonder.id]!;
      const pairs: Array<[string, string]> = [
        [entry.shortEffect as string, wonder.shortEffect],
        [entry.effectText as string, wonder.effectText],
        [entry.flavor as string, wonder.flavor],
        ...wonder.facts.map((f, i) => [entry.facts![i], f] as [string, string]),
      ];
      for (const [local, english] of pairs) {
        total += 1;
        if (local !== english) translated += 1;
      }
    }
    // A few strings are legitimately identical across languages (proper
    // nouns, "SETI", unit-free effect lines), so allow a small margin.
    expect(translated / total, `${code} wonder lore looks untranslated`).toBeGreaterThan(0.9);
  });
});

describe('localizedWonder', () => {
  it('returns the active language prose over the English data', () => {
    const colossus = WONDERS.find((w) => w.id === 'colossus')!;
    setLanguage('de');
    const localized = localizedWonder(colossus);
    expect(localized.effectText).toBe(getWonderLore('colossus', 'de')!.effectText);
    expect(localized.effectText).not.toBe(colossus.effectText);
    expect(localized.facts.length).toBe(colossus.facts.length);
    // English falls back to the data object untouched.
    setLanguage(DEFAULT_LANGUAGE);
    expect(localizedWonder(colossus)).toBe(colossus);
  });

  it('never mutates the shared data object', () => {
    const pyramids = WONDERS.find((w) => w.id === 'pyramids')!;
    const before = pyramids.effectText;
    setLanguage('ja');
    localizedWonder(pyramids);
    setLanguage(DEFAULT_LANGUAGE);
    expect(pyramids.effectText).toBe(before);
  });
});

describe('wonderWikiUrl', () => {
  it('keeps the English URL for English', () => {
    const url = 'https://en.wikipedia.org/wiki/Colossus_of_Rhodes';
    expect(wonderWikiUrl(url, 'colossus', 'en')).toBe(url);
  });

  it('uses the curated localized title when known', () => {
    expect(wonderWikiUrl('https://en.wikipedia.org/wiki/Colossus_of_Rhodes', 'colossus', 'ja')).toBe(
      `https://ja.wikipedia.org/wiki/${encodeURIComponent('ロドスのコロッソス')}`,
    );
    expect(wonderWikiUrl('https://en.wikipedia.org/wiki/Silk_Road', 'silk_road', 'de')).toBe(
      'https://de.wikipedia.org/wiki/Seidenstra%C3%9Fe',
    );
  });

  it('falls back to the English slug on the localized subdomain', () => {
    // space_station has no curated title — subdomain swap.
    const url = 'https://en.wikipedia.org/wiki/International_Space_Station';
    expect(wonderWikiUrl(url, 'unmapped_wonder', 'fr')).toBe(
      'https://fr.wikipedia.org/wiki/International_Space_Station',
    );
  });

  it('covers every wonder that has a curated title map entry per language', () => {
    const ids = new Set(WONDERS.map((w) => w.id));
    for (const [id, byLang] of Object.entries(WONDER_WIKI_TITLES)) {
      expect(ids.has(id), `curated title for unknown wonder "${id}"`).toBe(true);
      for (const [lang, title] of Object.entries(byLang)) {
        expect((title as string).length, `${id}/${lang} title empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe('active language integration', () => {
  it('getWonderLore follows the active language', () => {
    setLanguage('ru');
    expect(getWonderLore('pyramids')).toBe(SHIPPED.ru.pyramids);
    setLanguage(DEFAULT_LANGUAGE);
    expect(getWonderLore('pyramids')).toBeUndefined(); // English = data
  });

  it('every shipped language id has a lore module', () => {
    for (const code of Object.keys(SHIPPED) as LanguageId[]) {
      expect(getWonderLore('colossus', code)).toBeDefined();
    }
  });
});
