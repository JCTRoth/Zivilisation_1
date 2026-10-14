/**
 * Which nation the setup wizard preselects, decided by the browser's own
 * language list.
 *
 * Pure data and pure functions, kept apart from `languages.ts` (which imports
 * nothing on purpose) so the registry stays usable from the data layer.
 *
 * ── What decides, and in what order ───────────────────────────────────────
 * A language the game *ships* is a deliberate signal: a player whose browser
 * says German or French is telling us what they read, and the matching nation
 * follows from that alone. Those four are checked first.
 *
 * English is the exception, and deliberately so. It is the world's lingua
 * franca — an Indian, a Singaporean and an Irishman all report `en` — so it
 * carries no national signal at all. For English, and for every language the
 * game does not ship, *geography* decides instead. That is what makes
 * `en-IN` the Indians rather than the Americans, which the "all countries
 * around the Indus get India" rule requires.
 *
 * The geographic rules are checked as a block, before the English split, so
 * they apply uniformly to both cases above.
 *
 * ── The rules, in the order they are applied ──────────────────────────────
 *  1. Shipped languages with a genuine or acknowledged match: German, French,
 *     Japanese (nearest neighbour: Chinese), Spanish and Portuguese (Romans).
 *  2. The Arabic world: the *country* decides. The Middle East gets Babylon,
 *     everywhere else Arabic — and the Arabophone countries of North Africa —
 *     gets Egypt.
 *  3. South Asia: the whole subcontinent, by language *or* by country.
 *  4. Central Asia: the five republics and Mongolia, by language or country.
 *  5. Former French colonies, by country. Arabic North Africa is excluded —
 *     it is settled by rule 2 — which is why those regions are absent below
 *     rather than subtracted.
 *  6. English, split by region: the British Isles keep the English, the rest
 *     of the Anglophone world gets the Americans.
 *  7. The remaining bridges: Slavic along the EU line, and the northern
 *     Europeans.
 *  8. Anything else keeps the standing default, so a player is never handed a
 *     nation for reasons nobody wrote down.
 */
import { CIVILIZATIONS } from './GameData';
import { browserLanguageTags } from '../i18n/languageDetection';

/**
 * What a language falls back to when no rule answers, and what any future
 * language gets until one is added. Matches the wizard's own historic default
 * so an unrouted browser is indistinguishable from the standing choice.
 */
export const FALLBACK_NATION = 'Germans';

/** The Arabophone countries of North Africa and the Sudan. */
const ARABIC_NORTH_AFRICA: ReadonlySet<string> = new Set([
  'EG', 'LY', 'TN', 'DZ', 'MA', 'MR', 'EH', 'SD',
]);

/** The Middle East — where the Arabophone world's other candidate stands. */
const MIDDLE_EAST: ReadonlySet<string> = new Set([
  'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'SY', 'LB', 'JO', 'PS',
]);

/** The Indus and its neighbours: the whole southern-Asian subcontinent. */
const SOUTH_ASIA_REGIONS: ReadonlySet<string> = new Set([
  'IN', 'PK', 'BD', 'NP', 'LK', 'AF', 'BT', 'MV',
]);

/**
 * South Asian languages. Only the ones spoken across the subcontinent —
 * deliberately NOT including Persian (`fa`), which is Iran's language rather
 * than the Indus valley's; `fa-AF` still reaches India through the region.
 */
const SOUTH_ASIA_LANGUAGES: ReadonlySet<string> = new Set([
  'hi', 'ur', 'pa', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'ne', 'si',
  'ps', 'sd', 'as', 'or', 'bh', 'ks', 'mai', 'raj', 'kok', 'doi', 'sa',
]);

/** The five Central Asian republics plus Mongolia. */
const CENTRAL_ASIA_REGIONS: ReadonlySet<string> = new Set([
  'KZ', 'UZ', 'TM', 'KG', 'TJ', 'MN',
]);

const CENTRAL_ASIA_LANGUAGES: ReadonlySet<string> = new Set([
  'kk', 'ky', 'uz', 'tk', 'tg', 'mn',
]);

/**
 * Former French colonies, by country — the cases where the browser no longer
 * reports French (`vi-VN`, `mg-MG`, `km-KH`) and so the language rule would
 * miss them.
 *
 * Arabic North Africa (Egypt, Libya, Tunisia, Algeria, Morocco, Sudan,
 * Mauritania, Western Sahara) is NOT listed: rule 2 settles those as Arabic,
 * which is the exclusion the design asks for. Lebanon and Syria are absent for
 * the same reason — the French Mandate notwithstanding, they are Arabic
 * countries of the Middle East and belong to Babylon.
 */
const FORMER_FRENCH_COLONY: ReadonlySet<string> = new Set([
  // French Indochina
  'VN', 'KH', 'LA',
  // French West Africa
  'SN', 'ML', 'BF', 'CI', 'TG', 'BJ', 'NE',
  // French Equatorial Africa, and Madagascar
  'CM', 'GA', 'CF', 'CG', 'MG',
]);

/** British Isles — the English they kept when the Anglophone world split. */
const BRITISH_ISLES: ReadonlySet<string> = new Set(['GB', 'IE']);

/**
 * Slavic languages of the European Union, plus the Sorbian and Kashubian
 * minorities, which are spoken only inside Germany and Poland and are
 * therefore EU-resident for this purpose. Ukraine is included per the design
 * decision, not because it is an EU member.
 */
const EU_SLAVIC: ReadonlySet<string> = new Set([
  'pl', 'cs', 'sk', 'sl', 'hr', 'bg', 'uk',
  'hsb', 'dsb', 'csb',
]);

/** Slavic languages outside the EU: Russia's own family, and its neighbours. */
const NON_EU_SLAVIC: ReadonlySet<string> = new Set([
  'ru', 'be', 'rue', 'sr', 'bs', 'me', 'mk',
]);

/** Estonia and the Nordic countries. */
const NORTHERN_EUROPE: ReadonlySet<string> = new Set([
  'et', 'sv', 'no', 'nb', 'nn', 'da', 'kl', 'fi', 'is', 'fo',
]);

/**
 * Spanish and Portuguese, in every regional dress they arrive in. The
 * regional sets are exhaustive-by-construction rather than listed: there is no
 * Spanish- or Portuguese-speaking country whose nation should differ.
 */
const ROMANCE_LANGUAGE: ReadonlySet<string> = new Set(['es', 'pt']);

/**
 * The four geographic rules, as one block — checked before the English split
 * so `en-IN` and `hi-IN` resolve the same way, and before the Slavic bridges
 * so they read as geography rather than as a language afterthought.
 *
 * Order inside the block: a country's region is the strongest signal (it is
 * what the rule names), then the language, then the French-colony carve-out.
 */
function geographicNation(language: string, region: string): string | null {
  // The subcontinent, before anything Arabic — Pakistan is on the Indus even
  // though Arabic is one of its official languages.
  if (SOUTH_ASIA_REGIONS.has(region)) return 'Indians';
  if (CENTRAL_ASIA_REGIONS.has(region)) return 'Huns';

  // The Middle East first, so an Arabophone Middle Eastern country lands on
  // Babylon rather than being swept into Egypt.
  if (MIDDLE_EAST.has(region)) return 'Babylonians';

  // Every other Arabic-speaking country — including all of North Africa.
  if (language === 'ar' || ARABIC_NORTH_AFRICA.has(region)) return 'Egyptians';

  // By language, for the case where the region is foreign but the tongue is
  // not: a Hindi speaker whose browser is set to `hi-US`.
  if (SOUTH_ASIA_LANGUAGES.has(language)) return 'Indians';
  if (CENTRAL_ASIA_LANGUAGES.has(language)) return 'Huns';

  // Former French colonies the browser no longer reports French for.
  if (FORMER_FRENCH_COLONY.has(region)) return 'French';

  return null;
}

/**
 * Resolve one BCP-47 tag to a nation, or null when no rule answers and the
 * caller should keep looking further down the browser's list.
 */
export function resolveNationForTag(tag: unknown): string | null {
  const { language, region } = parseTag(tag);
  if (!language) return null;

  // A language the game ships is a deliberate signal — it decides on its own,
  // and a German in India is a German who reads German.
  if (language === 'de') return 'Germans';
  if (language === 'fr') return 'French';
  // Japanese has no counterpart among the fourteen nations. Chinese is the
  // only East Asian option on the board — a nearest neighbour, not a match,
  // and it is named as such rather than passed off as a translation.
  if (language === 'ja') return 'Chinese';
  if (ROMANCE_LANGUAGE.has(language)) return 'Romans';

  // Geography decides for English (a lingua franca, so it says nothing about
  // where) and for every language we do not ship.
  const geographic = geographicNation(language, region);
  if (geographic) return geographic;

  // English, split by region. `en-GB`/`en-IE` are the British Isles; every
  // other English-speaking country is Anglophone and gets the Americans.
  if (language === 'en') {
    if (!region || BRITISH_ISLES.has(region)) return 'English';
    return 'Americans';
  }

  // The remaining language bridges: Slavic along the EU line, and the north.
  if (EU_SLAVIC.has(language)) return 'Germans';
  if (NON_EU_SLAVIC.has(language)) return 'Russians';
  if (NORTHERN_EUROPE.has(language)) return 'Germans';

  return null;
}

/**
 * The nation for a browser's ordered language list. The first tag any rule
 * answers for wins, so a browser offering `['fr-CA', 'en-US']` gets the
 * French rather than falling through to the Americans.
 */
export function resolveNationForTags(tags: readonly string[]): string {
  for (const tag of tags) {
    const nation = resolveNationForTag(tag);
    if (nation) return nation;
  }
  return FALLBACK_NATION;
}

/**
 * The nation the wizard opens on, read from the browser at call time.
 *
 * No stored preference is consulted: unlike the UI language, the preselected
 * nation is not a setting — it is a courtesy that the player overwrites by
 * clicking, on the very screen where it appears.
 */
export function defaultNationForBrowser(): string {
  return resolveNationForTags(browserLanguageTags());
}

/**
 * Index into `CIVILIZATIONS` for the browser, or 0 when nothing resolves —
 * the caller's indexing then lands on a real civ rather than on undefined.
 */
export function defaultNationIndexForBrowser(): number {
  return nationIndex(defaultNationForBrowser());
}

/** The nation's name, for callers that would otherwise re-derive it. */
export function defaultNationForLanguage(language: string): string {
  return resolveNationForTags([language]);
}

/** Index into `CIVILIZATIONS` for a bare language id or a full tag. */
export function defaultNationIndexForLanguage(language: string): number {
  return nationIndex(defaultNationForLanguage(language));
}

/**
 * Whether any rule answers for this tag, as opposed to the fallback. Needed
 * because a genuine match can coincide with the fallback value — German →
 * Germans is a rule, not an absence, and a caller cannot tell them apart by
 * looking at the returned name.
 */
export function hasNationForTag(tag: unknown): boolean {
  return resolveNationForTag(tag) !== null;
}

function nationIndex(nation: string): number {
  const index = CIVILIZATIONS.findIndex((civ) => civ.name === nation);
  return index >= 0 ? index : 0;
}

/**
 * Split a BCP-47 tag into its language and region.
 *
 * The region is the first two-letter subtag after the language, which is
 * correct for `de-AT` and for `sr-Latn-RS` alike — the four-letter script
 * subtag in the middle is skipped by length rather than by position.
 */
function parseTag(tag: unknown): { language: string; region: string } {
  if (typeof tag !== 'string' || tag.length === 0) return { language: '', region: '' };
  const parts = tag.split(/[-_]/).filter(Boolean);
  if (parts.length === 0) return { language: '', region: '' };

  const language = parts[0].toLowerCase();
  let region = '';
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length === 2) {
      region = parts[i].toUpperCase();
      break;
    }
  }
  return { language, region };
}
