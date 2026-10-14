/**
 * Which nation the setup wizard preselects, decided by the browser's own
 * language list.
 *
 * The wizard used to open on a hard-coded "Germans" whatever the browser said.
 * Now the rules below are applied, and every unrouted browser keeps that
 * standing default.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultNationForBrowser,
  defaultNationIndexForBrowser,
  defaultNationForLanguage,
  defaultNationIndexForLanguage,
  hasNationForTag,
  resolveNationForTag,
  resolveNationForTags,
  FALLBACK_NATION,
} from '@/data/CivilizationByLanguage';
import { CIVILIZATIONS } from '@/data/GameData';

const NAMES = new Set(CIVILIZATIONS.map((c) => c.name));

describe('English splits by region', () => {
  it('keeps the British Isles on the English', () => {
    expect(resolveNationForTag('en-GB')).toBe('English');
    expect(resolveNationForTag('en-IE')).toBe('English');
  });

  it('gives the rest of the Anglophone world the Americans', () => {
    for (const tag of ['en-US', 'en-CA', 'en-AU', 'en-NZ', 'en-ZA', 'en-SG']) {
      expect(resolveNationForTag(tag)).toBe('Americans');
    }
  });

  it('reads a bare `en` as the British Isles, since it carries no region', () => {
    // A tag with no region cannot claim to be American — the honest reading
    // of `en` alone is England.
    expect(resolveNationForTag('en')).toBe('English');
  });

  it('honours the region even through a script subtag', () => {
    // Unlikely for English, but the parser must skip `Latn` by length rather
    // than assume the region is the second subtag.
    expect(resolveNationForTag('en-Latn-GB')).toBe('English');
  });
});

describe('Spanish and Portuguese all get the Romans', () => {
  it('routes every Spanish-speaking country alike', () => {
    for (const tag of ['es', 'es-ES', 'es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'es-CU']) {
      expect(resolveNationForTag(tag)).toBe('Romans');
    }
  });

  it('routes every Portuguese-speaking country alike', () => {
    for (const tag of ['pt', 'pt-PT', 'pt-BR', 'pt-AO', 'pt-MZ']) {
      expect(resolveNationForTag(tag)).toBe('Romans');
    }
  });
});

describe('Slavic splits along the EU line', () => {
  it('gives the EU Slavic members and Ukraine the Germans', () => {
    // Ukraine is included by decision, not because it is an EU member.
    for (const tag of ['pl', 'cs', 'sk', 'sl', 'hr', 'bg', 'uk']) {
      expect(resolveNationForTag(tag)).toBe('Germans');
    }
  });

  it('gives the Sorbian and Kashubian minorities the Germans', () => {
    // Spoken only inside Germany and Poland, so EU-resident for this purpose.
    for (const tag of ['hsb', 'dsb', 'csb']) {
      expect(resolveNationForTag(tag)).toBe('Germans');
    }
  });

  it('gives the non-EU Slavic languages the Russians', () => {
    for (const tag of ['ru', 'be', 'rue', 'sr', 'bs', 'me', 'mk']) {
      expect(resolveNationForTag(tag)).toBe('Russians');
    }
  });

  it('applies the split through a regional tag', () => {
    expect(resolveNationForTag('pl-PL')).toBe('Germans');
    expect(resolveNationForTag('sr-RS')).toBe('Russians');
  });
});

describe('Estonia and the Nordics get the Germans', () => {
  it('routes every Nordic language alike', () => {
    for (const tag of ['sv', 'sv-SE', 'no', 'nb', 'nn', 'da', 'da-DK', 'fi', 'is', 'fo', 'kl']) {
      expect(resolveNationForTag(tag)).toBe('Germans');
    }
  });

  it('routes Estonian likewise', () => {
    expect(resolveNationForTag('et')).toBe('Germans');
    expect(resolveNationForTag('et-EE')).toBe('Germans');
  });
});

describe('resolveNationForTags — the browser\'s ordered list', () => {
  it('takes the first tag any rule answers for', () => {
    // A browser offering several languages lists them best-first.
    expect(resolveNationForTags(['fr-CA', 'en-US'])).toBe('French');
    expect(resolveNationForTags(['en-US', 'fr-CA'])).toBe('Americans');
  });

  it('skips a tag no rule answers for and keeps looking', () => {
    // An Italian browser that also lists German should get the Germans, not
    // the fallback.
    expect(resolveNationForTags(['it-IT', 'de-DE'])).toBe('Germans');
  });

  it('falls back when nothing in the list is routed', () => {
    expect(resolveNationForTags(['it-IT', 'tr-TR'])).toBe(FALLBACK_NATION);
    expect(resolveNationForTags([])).toBe(FALLBACK_NATION);
  });

  it('ignores unusable entries', () => {
    expect(resolveNationForTags([null as unknown as string, 'fr'])).toBe('French');
    expect(resolveNationForTags([''])).toBe(FALLBACK_NATION);
  });
});

describe('resolveNationForTag — the fallback and its honesty', () => {
  it('returns null for a language no rule covers', () => {
    // Null, not the fallback, so the caller can keep walking the browser's
    // preference list. `ar` is deliberately absent here — it IS routed, to
    // Egypt or Babylon depending on the country.
    expect(resolveNationForTag('it')).toBeNull();
    expect(resolveNationForTag('zh')).toBeNull();
    expect(resolveNationForTag('xx')).toBeNull();
    expect(resolveNationForTag('fa')).toBeNull(); // Persian = Iran, unrouted
  });

  it('reports honestly whether a tag is routed', () => {
    expect(hasNationForTag('en-US')).toBe(true);
    expect(hasNationForTag('de')).toBe(true);
    expect(hasNationForTag('pl')).toBe(true);
    expect(hasNationForTag('it')).toBe(false);
    expect(hasNationForTag('')).toBe(false);
  });

  it('cannot be told apart from the fallback by the returned name alone', () => {
    // German → Germans is a rule; Italian → Germans is the fallback. Both
    // names are "Germans", which is exactly why `hasNationForTag` exists.
    expect(resolveNationForTag('de')).toBe(FALLBACK_NATION);
    expect(hasNationForTag('de')).toBe(true);
    expect(hasNationForTag('it')).toBe(false);
  });
});

describe('the browser accessors', () => {
  it('always resolves to a nation this game actually ships', () => {
    for (const probe of [
      undefined, {}, { language: 'en-US' }, { language: 'en-GB' },
      { languages: ['pl-PL'] }, { languages: ['pt-BR'] }, { languages: ['it-IT'] },
    ]) {
      withNavigator(probe, () => {
        expect(NAMES.has(defaultNationForBrowser())).toBe(true);
        expect(CIVILIZATIONS[defaultNationIndexForBrowser()]).toBeDefined();
      });
    }
  });

  it('reads the region out of a real browser list', () => {
    withNavigator({ language: 'en-US', languages: ['en-US'] }, () => {
      expect(defaultNationForBrowser()).toBe('Americans');
    });
    withNavigator({ language: 'en-GB', languages: ['en-GB'] }, () => {
      expect(defaultNationForBrowser()).toBe('English');
    });
  });

  it('falls back to the standing default when there is no navigator', () => {
    withNavigator(undefined, () => {
      expect(defaultNationForBrowser()).toBe(FALLBACK_NATION);
    });
  });

  it('reads a bare language id the same way a tag is read', () => {
    // Kept for callers that only have the resolved game language and no
    // region — it cannot split English, and says so by giving `en` the
    // British Isles.
    expect(defaultNationForLanguage('en')).toBe('English');
    expect(defaultNationForLanguage('de')).toBe('Germans');
    expect(defaultNationForLanguage('pt')).toBe('Romans');
    expect(defaultNationForLanguage('uk')).toBe('Germans');
    expect(defaultNationForLanguage('xx')).toBe(FALLBACK_NATION);
    expect(CIVILIZATIONS[defaultNationIndexForLanguage('xx')]).toBeDefined();
  });
});

describe('the table stays honest as rules are added', () => {
  it('never hands out a nation this game does not ship', () => {
    const probes = [
      'en-US', 'en-GB', 'en', 'de', 'fr', 'ru', 'es', 'pt', 'pt-BR',
      'pl', 'cs', 'sk', 'sl', 'hr', 'bg', 'uk', 'sr', 'be', 'bs', 'me', 'mk',
      'et', 'sv', 'no', 'da', 'fi', 'is', 'fo', 'kl',
      'it', 'zh', 'ar', 'tr', 'xx', '',
    ];
    for (const probe of probes) {
      expect(NAMES.has(resolveNationForTags([probe]))).toBe(true);
    }
  });
});

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

describe('the Arabic world splits by country', () => {
  it('sends the Middle East to Babylon', () => {
    for (const tag of ['ar-SA', 'ar-AE', 'ar-IQ', 'ar-SY', 'ar-LB', 'ar-JO', 'ar-PS', 'ar-YE']) {
      expect(resolveNationForTag(tag)).toBe('Babylonians');
    }
  });

  it('sends North Africa and the rest of the Arabophone world to Egypt', () => {
    for (const tag of ['ar-EG', 'ar-DZ', 'ar-MA', 'ar-TN', 'ar-LY', 'ar-SD', 'ar-MR']) {
      expect(resolveNationForTag(tag)).toBe('Egyptians');
    }
    // Not Middle Eastern and not North African, but still Arabic.
    expect(resolveNationForTag('ar-SO')).toBe('Egyptians');
  });

  it('sends a Middle Eastern country there whatever language it reports', () => {
    // The rule names the COUNTRY. An English browser in the Emirates is still
    // in the country the rule is about.
    expect(resolveNationForTag('en-AE')).toBe('Babylonians');
    expect(resolveNationForTag('en-EG')).toBe('Egyptians');
  });

  it('leaves Arabic North Africa out of the French-colony rule', () => {
    // The exclusion the design asks for: these countries are settled as
    // Arabic, never swept to the French by the carve-out.
    for (const tag of ['ar-DZ', 'ar-MA', 'ar-TN', 'ar-LY']) {
      expect(resolveNationForTag(tag)).not.toBe('French');
    }
  });

  it('keeps the Middle East out of Egypt even for a bare Arabic tag', () => {
    // A tag with no region cannot name a country, so it falls to the
    // Arabophone default rather than guessing Babylon.
    expect(resolveNationForTag('ar')).toBe('Egyptians');
  });
});

describe('the whole Indus subcontinent gets India', () => {
  it('routes every South Asian country', () => {
    for (const tag of ['en-IN', 'en-PK', 'en-BD', 'en-NP', 'en-LK', 'en-AF', 'en-BT', 'en-MV']) {
      expect(resolveNationForTag(tag)).toBe('Indians');
    }
  });

  it('routes South Asian languages wherever the player happens to live', () => {
    // A Hindi speaker whose browser is `hi-US` is still a Hindi speaker.
    for (const tag of ['hi-IN', 'ur-PK', 'bn-BD', 'ta-LK', 'ne-NP', 'hi-US']) {
      expect(resolveNationForTag(tag)).toBe('Indians');
    }
  });

  it('does not sweep up Persian, which is Iran rather than the Indus', () => {
    // `fa` alone is Iran and unrouted; `fa-AF` reaches India by country.
    expect(resolveNationForTag('fa')).toBeNull();
    expect(resolveNationForTag('fa-IR')).toBeNull();
    expect(resolveNationForTag('fa-AF')).toBe('Indians');
  });
});

describe('Central Asia gets the Huns', () => {
  it('routes the five republics and Mongolia', () => {
    for (const tag of ['kk-KZ', 'uz-UZ', 'tk-TM', 'ky-KG', 'tg-TJ', 'mn-MN']) {
      expect(resolveNationForTag(tag)).toBe('Huns');
    }
  });

  it('routes those countries whatever language they report', () => {
    for (const tag of ['en-KZ', 'ru-KZ', 'en-MN']) {
      expect(resolveNationForTag(tag)).toBe('Huns');
    }
  });

  it('routes the languages by name even outside the region', () => {
    expect(resolveNationForTag('kk-US')).toBe('Huns');
    expect(resolveNationForTag('mn-US')).toBe('Huns');
  });

  it('leaves Turkey alone — Turkic, but not Central Asian', () => {
    expect(resolveNationForTag('tr-TR')).toBeNull();
  });
});

describe('former French colonies get France', () => {
  it('routes the cases where the browser no longer reports French', () => {
    for (const tag of ['vi-VN', 'km-KH', 'lo-LA', 'mg-MG', 'wo-SN', 'bm-ML']) {
      expect(resolveNationForTag(tag)).toBe('French');
    }
  });

  it('routes an English browser sitting in a former colony', () => {
    expect(resolveNationForTag('en-VN')).toBe('French');
    expect(resolveNationForTag('en-MG')).toBe('French');
  });

  it('still gives a French browser its French', () => {
    // Already covered by the shipped-language rule — the two agree here.
    for (const tag of ['fr-SN', 'fr-ML', 'fr-VN', 'fr-DZ']) {
      expect(resolveNationForTag(tag)).toBe('French');
    }
  });
});
