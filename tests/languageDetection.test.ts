/**
 * Browser-language detection — the game's first guess at which language you
 * read, used only until you pick one yourself.
 *
 * A stored choice always wins; these tests cover the guess itself.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBrowserLanguage,
  detectBrowserLanguage,
} from '@/i18n/languageDetection';
import { LANGUAGES } from '@/i18n/languages';

describe('resolveBrowserLanguage — shipped languages are taken as they are', () => {
  it('maps every shipped language to itself', () => {
    for (const language of LANGUAGES) {
      expect(resolveBrowserLanguage([language.id])).toBe(language.id);
    }
  });

  it('ignores the region part of a tag', () => {
    // `de-AT` is Austrian German, not a separate language the game ships.
    expect(resolveBrowserLanguage(['de-AT'])).toBe('de');
    expect(resolveBrowserLanguage(['fr-CA'])).toBe('fr');
    expect(resolveBrowserLanguage(['ja-JP'])).toBe('ja');
  });

  it('accepts an underscore separator as well as a hyphen', () => {
    // Some browsers and OSes report `pt_BR` rather than `pt-BR`.
    expect(resolveBrowserLanguage(['de_DE'])).toBe('de');
    expect(resolveBrowserLanguage(['ru_RU'])).toBe('ru');
  });

  it('is case-insensitive about the subtag', () => {
    expect(resolveBrowserLanguage(['EN'])).toBe('en');
    expect(resolveBrowserLanguage(['DE-de'])).toBe('de');
  });

  it('honours the browser\'s preference order', () => {
    // A browser offering several languages lists them best-first.
    expect(resolveBrowserLanguage(['fr', 'de'])).toBe('fr');
    expect(resolveBrowserLanguage(['de', 'fr'])).toBe('de');
  });
});

describe('resolveBrowserLanguage — the Slavic bridge to Russian', () => {
  it('sends every Slavic language to Russian', () => {
    const slavic = [
      // East
      'ru', 'uk', 'be', 'rue',
      // West
      'pl', 'cs', 'sk', 'hsb', 'dsb', 'csb',
      // South
      'sl', 'hr', 'sr', 'bs', 'me', 'bg', 'mk',
    ];
    for (const tag of slavic) {
      expect(resolveBrowserLanguage([tag])).toBe('ru');
    }
  });

  it('applies the bridge through a regional tag', () => {
    expect(resolveBrowserLanguage(['pl-PL'])).toBe('ru');
    expect(resolveBrowserLanguage(['sr-Latn-RS'])).toBe('ru');
  });

  it('does not sweep up languages that merely neighbour the Slavic ones', () => {
    // Romanian, Hungarian, Lithuanian and Finnish are all Eastern European
    // but not Slavic — routing them to Russian would be a guess, not a bridge.
    for (const tag of ['ro', 'hu', 'lt', 'lv', 'et', 'fi']) {
      expect(resolveBrowserLanguage([tag])).toBe('en');
    }
  });
});

describe('resolveBrowserLanguage — Portuguese routes to Spanish', () => {
  it('sends Portuguese to Spanish', () => {
    expect(resolveBrowserLanguage(['pt'])).toBe('es');
  });

  it('sends both European and Brazilian Portuguese alike', () => {
    expect(resolveBrowserLanguage(['pt-PT'])).toBe('es');
    expect(resolveBrowserLanguage(['pt-BR'])).toBe('es');
  });
});

describe('resolveBrowserLanguage — everything else falls back to English', () => {
  it('sends an unshipped language to English', () => {
    for (const tag of ['it', 'nl', 'tr', 'zh', 'ko', 'ar', 'hi', 'sv', 'da', 'no', 'fi']) {
      expect(resolveBrowserLanguage([tag])).toBe('en');
    }
  });

  it('falls back to English when nothing is usable at all', () => {
    expect(resolveBrowserLanguage([])).toBe('en');
    expect(resolveBrowserLanguage(['', ''])).toBe('en');
  });

  it('skips unusable entries and keeps looking down the list', () => {
    // A malformed first tag must not shadow a good one behind it.
    expect(resolveBrowserLanguage(['', 'de'])).toBe('de');
    expect(resolveBrowserLanguage([null as unknown as string, 'fr'])).toBe('fr');
  });

  it('never returns a language the game does not ship', () => {
    const shipped = new Set(LANGUAGES.map((l) => l.id));
    const probes = ['xx', 'zz', 'qq-QQ', 'de-CH', 'pt-BR', 'pl', 'it', ''];
    for (const probe of probes) {
      expect(shipped.has(resolveBrowserLanguage([probe]))).toBe(true);
    }
  });
});

describe('detectBrowserLanguage — reads the browser defensively', () => {
  /** Swap in a fake navigator for the duration of one assertion. */
  function withNavigator(fake: unknown, run: () => void): void {
    const original = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: fake,
      configurable: true,
      writable: true,
    });
    try {
      run();
    } finally {
      if (original === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    }
  }

  it('reads the ordered preference list when the browser provides one', () => {
    withNavigator({ language: 'en-US', languages: ['pl-PL', 'en-US'] }, () => {
      // Polish first, so the Slavic bridge applies before English is reached.
      expect(detectBrowserLanguage()).toBe('ru');
    });
  });

  it('falls back to the single `language` value when there is no list', () => {
    withNavigator({ language: 'pt-BR' }, () => {
      expect(detectBrowserLanguage()).toBe('es');
    });
  });

  it('reads an empty list as no list at all', () => {
    withNavigator({ language: 'fr-FR', languages: [] }, () => {
      expect(detectBrowserLanguage()).toBe('fr');
    });
  });

  it('degrades to English when the browser reports nothing usable', () => {
    withNavigator({ language: 'it-IT' }, () => {
      expect(detectBrowserLanguage()).toBe('en');
    });
    withNavigator({}, () => {
      expect(detectBrowserLanguage()).toBe('en');
    });
  });

  it('degrades to English when there is no navigator at all', () => {
    // Node, or a context where navigator was stripped.
    withNavigator(undefined, () => {
      expect(detectBrowserLanguage()).toBe('en');
    });
  });

  it('always returns a language the game ships', () => {
    const shipped = new Set(LANGUAGES.map((l) => l.id));
    for (const fake of [
      undefined,
      {},
      { language: 'xx' },
      { language: 'pl' },
      { languages: ['sr-ME'] },
      { languages: ['pt'] },
    ]) {
      withNavigator(fake, () => {
        expect(shipped.has(detectBrowserLanguage())).toBe(true);
      });
    }
  });
});
