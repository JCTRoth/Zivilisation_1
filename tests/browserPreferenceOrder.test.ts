/**
 * The browser's ordered language preferences drive BOTH the UI language and
 * the preselected nation.
 *
 * The browser setting reads "Some web pages are displayed in multiple
 * languages. Choose languages in your preferred order." That ordered list is
 * the input to two independent resolvers, and the property worth pinning is
 * not merely that each works, but that they AGREE on which entry won.
 *
 * A player listing Italian first and German second should land on German for
 * both — not on German UI with an Italian nation because one resolver stopped
 * at a different tag than the other.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBrowserLanguage,
  resolveBrowserLanguageForTag,
} from '@/i18n/languageDetection';
import {
  resolveNationForTags,
  resolveNationForTag,
} from '@/data/CivilizationByLanguage';

/**
 * Index of the first entry in the list a per-tag resolver answers for, or -1
 * when it answers for none. Both resolvers are per-tag and null-returning, so
 * the same walk measures both.
 */
function winningIndex(
  tags: readonly string[],
  resolve: (tag: string) => unknown,
): number {
  return tags.findIndex((tag) => resolve(tag) !== null);
}

describe('the two resolvers settle on the same entry of the list', () => {
  it('skips an unrouted first entry together', () => {
    // Italian is neither shipped nor bridged, so both resolvers must pass it
    // by and land on the German entry.
    const tags = ['it-IT', 'de-DE'];
    expect(winningIndex(tags, resolveBrowserLanguageForTag)).toBe(1);
    expect(winningIndex(tags, resolveNationForTag)).toBe(1);
    expect(resolveBrowserLanguage(tags)).toBe('de');
    expect(resolveNationForTags(tags)).toBe('Germans');
  });

  it('stops at the first entry when both route it', () => {
    const tags = ['fr-CA', 'en-US'];
    expect(winningIndex(tags, resolveBrowserLanguageForTag)).toBe(0);
    expect(winningIndex(tags, resolveNationForTag)).toBe(0);
    expect(resolveBrowserLanguage(tags)).toBe('fr');
    expect(resolveNationForTags(tags)).toBe('French');
  });

  it('stops at the first entry for Portuguese, which routes both ways', () => {
    // pt bridges to Spanish for the UI and to the Romans as a nation — same
    // entry, two different answers, exactly as the rules intend.
    const tags = ['pt-BR', 'en-US'];
    expect(winningIndex(tags, resolveBrowserLanguageForTag)).toBe(0);
    expect(winningIndex(tags, resolveNationForTag)).toBe(0);
    expect(resolveBrowserLanguage(tags)).toBe('es');
    expect(resolveNationForTags(tags)).toBe('Romans');
  });

  it('never has the language settled from an earlier entry than the nation', () => {
    // Correct direction, and deliberately so: the NATION rules are the
    // broader set now (geography covers countries whose language this game
    // does not ship), so the nation may well settle first — a Hindi browser
    // in India routes to Indians while `hi` ships no UI language at all.
    // The converse was true before the subcontinental rules existed, and this
    // is the direction that actually holds.
    const lists: readonly (readonly string[])[] = [
      ['it-IT', 'de-DE'],
      ['zh-CN', 'fr-FR', 'en-GB'],
      ['pl-PL', 'de-DE'],
      ['pt-BR', 'en-GB'],
      ['en-US', 'de-DE'],
      ['ja-JP', 'en-US'],
      ['sr-RS', 'en-GB'],
      ['', 'de-DE'],
      // The case the new rules created: nation first, language later.
      ['hi-IN', 'de-DE'],
      ['vi-VN', 'en-US'],
      ['ar-EG', 'fr-FR'],
    ];

    for (const tags of lists) {
      const languageIndex = winningIndex(tags, resolveBrowserLanguageForTag);
      const nationIndex = winningIndex(tags, resolveNationForTag);
      // -1 means "no entry routed", which is after every real entry.
      const normalised = (index: number) => (index === -1 ? tags.length : index);
      expect(normalised(nationIndex)).toBeLessThanOrEqual(normalised(languageIndex));
    }
  });

  it('reads a Slavic first entry as settled for both, despite different answers', () => {
    // Polish → Russian (UI) and Polish → Germans (nation). Different answers,
    // SAME entry: that is what keeping the rules independent while reading one
    // list actually means.
    const tags = ['pl-PL', 'en-US'];
    expect(winningIndex(tags, resolveBrowserLanguageForTag)).toBe(0);
    expect(winningIndex(tags, resolveNationForTag)).toBe(0);
    expect(resolveBrowserLanguage(tags)).toBe('ru');
    expect(resolveNationForTags(tags)).toBe('Germans');
  });
});

describe('every tag the language resolver settles on is also settled for the nation', () => {
  it('holds across a spread of realistic preference lists', () => {
    // A language the game ships should never be skipped by the nation rules
    // while the language rules took it — that would mean the two resolvers
    // read different lists.
    const tags = [
      'en-US', 'en-GB', 'en-IE', 'de-DE', 'fr-FR', 'fr-CA', 'ru-RU',
      'es-ES', 'es-MX', 'pt-BR', 'pt-PT', 'ja-JP', 'pl-PL', 'cs-CZ',
      'uk-UA', 'sr-RS', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'et-EE',
      'it-IT', 'nl-NL', 'zh-CN', 'tr-TR',
    ];

    for (const tag of tags) {
      const language = resolveBrowserLanguageForTag(tag);
      // Every tag the language layer routes must also be a tag the nation
      // layer routes — a routed language with no nation would silently hand
      // that player the fallback nation.
      if (language) {
        expect(resolveNationForTag(tag)).not.toBeNull();
      }
    }
  });
});
